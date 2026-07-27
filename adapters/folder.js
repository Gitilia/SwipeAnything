'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Adapter } = require('./base');
const { getThumbnail } = require('../lib/thumbnails');
const { collectFileDetails } = require('../lib/file-details');
const { listZipEntries, formatZipListing } = require('../lib/zip-list');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tiff', 'tif', 'avif']);
const RAW_EXT = new Set([
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'orf',
  'rw2',
  'raf',
  'pef',
  'ptx',
  'x3f',
  'raw',
  'rwl',
  'srw',
]);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const PDF_EXT = new Set(['pdf']);
const ZIP_EXT = new Set(['zip']);
const TEXT_EXT = new Set(['txt', 'md', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml']);
const DEST_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

function extOf(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

// Express/`send`'s bundled mime database doesn't know some of these, and
// browsers need the right Content-Type to render/play a streamed preview.
const MIME_OVERRIDES = {
  heic: 'image/heic',
  heif: 'image/heif',
  flac: 'audio/flac',
  dng: 'image/x-adobe-dng',
};

function previewTypeFor(filePath) {
  const ext = extOf(filePath);
  if (IMAGE_EXT.has(ext) || RAW_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (PDF_EXT.has(ext)) return 'pdf';
  if (ZIP_EXT.has(ext)) return 'archive';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'none';
}

/** Exts whose original bytes don't render in most browsers — serve QL thumb as preview when possible. */
function needsThumbnailPreview(filePath) {
  const ext = extOf(filePath);
  return RAW_EXT.has(ext) || ext === 'heic' || ext === 'heif';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function idFor(relativePath) {
  return Buffer.from(relativePath).toString('base64url');
}

function pathForId(id) {
  return Buffer.from(id, 'base64url').toString('utf8');
}

function parseDestinations(raw) {
  const destinations = {};
  if (!raw || typeof raw !== 'object') return destinations;
  for (const key of DEST_KEYS) {
    const entry = raw[key];
    if (!entry) continue;
    const folderPath = typeof entry === 'string' ? entry : entry.path;
    if (!folderPath || !String(folderPath).trim()) continue;
    const resolved = path.resolve(String(folderPath).trim());
    const label =
      (typeof entry === 'object' && entry.label && String(entry.label).trim()) ||
      path.basename(resolved) ||
      `Folder ${key}`;
    destinations[key] = { key, path: resolved, label };
  }
  return destinations;
}

/**
 * Reference adapter: point at any local folder and swipe through its files.
 * "Reject" never deletes -- it moves the file into a trash folder alongside
 * the source, and "Undo" moves it right back. Number keys 0–9 can move a
 * file into configured destination folders (organize, not just triage).
 * "Empty trash" (a separate, confirm-guarded action) is the only place this
 * adapter permanently deletes anything.
 */
class FolderAdapter extends Adapter {
  static id = 'folder';
  static label = 'Local folder';
  static description =
    'Point at any local folder and swipe through its files. Rejected files move to a trash folder; keys 0–9 can organize into other folders.';

  static configSchema = [
    {
      key: 'folderPath',
      label: 'Folder path',
      type: 'folder',
      required: true,
      placeholder: '/Users/you/Pictures/to-sort',
    },
    { key: 'recursive', label: 'Include subfolders', type: 'checkbox', default: false },
    {
      key: 'extensions',
      label: 'File extensions (comma separated, blank = all files)',
      type: 'text',
      default: 'jpg,jpeg,png,gif,webp,heic,bmp,pdf,dng,cr2,nef,arw,mp4,mov',
      placeholder: 'jpg,jpeg,png,heic,pdf,dng,mp4,mov',
    },
    { key: 'trashDirName', label: 'Trash folder name', type: 'text', default: '.swipeanything-trash' },
    {
      key: 'showDetailsByDefault',
      label: 'Show file details on each card by default',
      type: 'checkbox',
      default: false,
    },
    {
      key: 'destinations',
      label: 'Organize folders (keys 0–9)',
      type: 'folderMap',
      default: {},
    },
  ];

  static actions = [
    { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right', group: 'primary' },
    { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true, group: 'primary' },
    { id: 'skip', label: 'Skip', key: 'ArrowDown', direction: 'down', group: 'primary' },
  ];

  constructor(settings) {
    super(settings);
    this.folderPath = path.resolve(settings.folderPath || '.');
    this.trashDirName = settings.trashDirName || '.swipeanything-trash';
    this.trashDir = path.join(this.folderPath, this.trashDirName);
    this.recursive = Boolean(settings.recursive);
    const extList = String(settings.extensions || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    this.extensions = extList.length ? new Set(extList) : null; // null = allow all
    this.destinations = parseDestinations(settings.destinations);
    this.showDetailsByDefault = Boolean(settings.showDetailsByDefault);
  }

  getActions() {
    const actions = this.constructor.actions.map((a) => ({ ...a }));
    for (const key of DEST_KEYS) {
      const dest = this.destinations[key];
      if (!dest) continue;
      actions.push({
        id: `move-${key}`,
        label: dest.label,
        key,
        group: 'organize',
        destPath: dest.path,
      });
    }
    return actions;
  }

  async init() {
    const stat = await fsp.stat(this.folderPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Folder not found: ${this.folderPath}`);
    }
    await fsp.mkdir(this.trashDir, { recursive: true });

    for (const dest of Object.values(this.destinations)) {
      if (dest.path === this.folderPath) {
        throw new Error(`Destination ${dest.key} cannot be the same as the source folder`);
      }
      await fsp.mkdir(dest.path, { recursive: true });
      const destStat = await fsp.stat(dest.path).catch(() => null);
      if (!destStat || !destStat.isDirectory()) {
        throw new Error(`Destination ${dest.key} is not a folder: ${dest.path}`);
      }
    }
  }

  _isExcludedDir(absPath) {
    if (absPath === this.trashDir || absPath.startsWith(this.trashDir + path.sep)) return true;
    for (const dest of Object.values(this.destinations)) {
      if (absPath === dest.path || absPath.startsWith(dest.path + path.sep)) return true;
    }
    return false;
  }

  async _walk(dir, relativeBase = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skips dotfiles and our own trash dir
      const abs = path.join(dir, entry.name);
      const rel = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (this._isExcludedDir(abs)) continue;
        if (this.recursive) files = files.concat(await this._walk(abs, rel));
        continue;
      }
      const ext = extOf(entry.name);
      if (this.extensions && !this.extensions.has(ext)) continue;
      files.push(rel);
    }
    return files;
  }

  async list() {
    const relativePaths = await this._walk(this.folderPath);
    relativePaths.sort((a, b) => a.localeCompare(b));
    const items = [];
    for (const rel of relativePaths) {
      const abs = path.join(this.folderPath, rel);
      const stat = await fsp.stat(abs);
      const dir = path.dirname(rel);
      items.push({
        id: idFor(rel),
        title: path.basename(rel),
        subtitle: dir === '.' ? undefined : dir,
        previewType: previewTypeFor(rel),
        meta: {
          size: formatSize(stat.size),
          modified: stat.mtime.toISOString().slice(0, 10),
        },
      });
    }
    return items;
  }

  _absoluteFor(itemId) {
    const rel = pathForId(itemId);
    const abs = path.resolve(this.folderPath, rel);
    if (abs !== this.folderPath && !abs.startsWith(this.folderPath + path.sep)) {
      throw new Error('Invalid item id');
    }
    return abs;
  }

  async streamPreview(itemId, res) {
    const abs = this._absoluteFor(itemId);
    if (!fs.existsSync(abs)) return false;

    if (ZIP_EXT.has(extOf(abs))) {
      try {
        const listing = await listZipEntries(abs);
        res.type('text/plain; charset=utf-8');
        res.send(formatZipListing(listing));
        return true;
      } catch (err) {
        res.type('text/plain; charset=utf-8');
        res.status(200).send(`(could not list zip: ${err.message})`);
        return true;
      }
    }

    // RAW / HEIC: browsers usually can't decode the original — prefer a Quick Look PNG.
    if (needsThumbnailPreview(abs)) {
      const thumbPath = await getThumbnail(abs);
      if (thumbPath) {
        res.type('image/png');
        res.sendFile(thumbPath);
        return true;
      }
    }

    const override = MIME_OVERRIDES[extOf(abs)];
    if (override) res.type(override);
    res.sendFile(abs);
    return true;
  }

  async streamThumbnail(itemId, res) {
    const abs = this._absoluteFor(itemId);
    if (!fs.existsSync(abs)) return false;
    const thumbPath = await getThumbnail(abs);
    if (!thumbPath) return false;
    res.sendFile(thumbPath);
    return true;
  }

  async getDetails(itemId) {
    const abs = this._absoluteFor(itemId);
    if (!fs.existsSync(abs)) throw new Error('File not found');
    const details = await collectFileDetails(abs);
    if (ZIP_EXT.has(extOf(abs))) {
      try {
        const listing = await listZipEntries(abs);
        const files = listing.entries.filter((e) => !e.isDir).length;
        details.fields.push({
          label: 'Zip entries',
          value: `${listing.totalEntries}${listing.truncated ? '+' : ''} (${files} files)`,
        });
        const sample = listing.entries
          .slice(0, 8)
          .map((e) => e.name)
          .join(', ');
        if (sample) details.fields.push({ label: 'Contains', value: sample + (listing.entries.length > 8 ? '…' : '') });
      } catch {
        // ignore listing failures in details
      }
    }
    details.actions = process.platform === 'darwin' ? [{ id: 'reveal', label: 'Reveal in Finder' }] : [];
    return details;
  }

  async reveal(itemId) {
    if (process.platform !== 'darwin') return false;
    const abs = this._absoluteFor(itemId);
    if (!fs.existsSync(abs)) throw new Error('File not found');
    await execFileAsync('open', ['-R', abs], { timeout: 5000 });
    return true;
  }

  uiHints() {
    return { showDetailsByDefault: this.showDetailsByDefault, supportsDetails: true };
  }

  async _uniqueTarget(destDir, basename) {
    let candidate = path.join(destDir, basename);
    if (!fs.existsSync(candidate)) return candidate;
    const ext = path.extname(basename);
    const stem = path.basename(basename, ext);
    let i = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(destDir, `${stem}-${i}${ext}`);
      i += 1;
    }
    return candidate;
  }

  async applyAction(item, actionId) {
    if (actionId === 'reject') {
      const from = this._absoluteFor(item.id);
      const to = path.join(this.trashDir, `${Date.now()}__${path.basename(from)}`);
      await fsp.rename(from, to);
      return { type: 'move', from, to };
    }

    const moveMatch = /^move-([0-9])$/.exec(actionId);
    if (moveMatch) {
      const dest = this.destinations[moveMatch[1]];
      if (!dest) throw new Error(`No destination configured for key ${moveMatch[1]}`);
      const from = this._absoluteFor(item.id);
      await fsp.mkdir(dest.path, { recursive: true });
      const to = await this._uniqueTarget(dest.path, path.basename(from));
      await fsp.rename(from, to);
      return { type: 'move', from, to, destKey: dest.key, destLabel: dest.label };
    }

    // 'keep' and 'skip' have no filesystem effect.
    return null;
  }

  async undo(record) {
    if (record && record.type === 'move') {
      await fsp.mkdir(path.dirname(record.from), { recursive: true });
      await fsp.rename(record.to, record.from);
    }
  }

  async describeTrash() {
    const entries = await fsp.readdir(this.trashDir).catch(() => []);
    const count = entries.filter((name) => !name.startsWith('.')).length;
    return { count, label: `${this.trashDirName} (permanent delete)` };
  }

  async emptyTrash() {
    const entries = await fsp.readdir(this.trashDir).catch(() => []);
    await Promise.all(
      entries
        .filter((name) => !name.startsWith('.'))
        .map((name) => fsp.rm(path.join(this.trashDir, name), { recursive: true, force: true }))
    );
  }

  describeSource() {
    const n = Object.keys(this.destinations).length;
    return n ? `${this.folderPath} · ${n} organize folder${n === 1 ? '' : 's'}` : this.folderPath;
  }
}

module.exports = { FolderAdapter, parseDestinations, DEST_KEYS };
