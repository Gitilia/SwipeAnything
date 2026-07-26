'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Adapter } = require('./base');
const { getThumbnail } = require('../lib/thumbnails');

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'svg', 'tiff', 'avif']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi']);
const TEXT_EXT = new Set(['txt', 'md', 'json', 'csv', 'log']);

function extOf(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

// Express/`send`'s bundled mime database doesn't know some of these, and
// browsers need the right Content-Type to render/play a streamed preview.
const MIME_OVERRIDES = {
  heic: 'image/heic',
  heif: 'image/heif',
  flac: 'audio/flac',
};

function previewTypeFor(filePath) {
  const ext = extOf(filePath);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (AUDIO_EXT.has(ext)) return 'audio';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'none';
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

/**
 * Reference adapter: point at any local folder and swipe through its files.
 * "Reject" never deletes -- it moves the file into a trash folder alongside
 * the source, and "Undo" moves it right back. "Empty trash" (a separate,
 * confirm-guarded action) is the only place this adapter permanently deletes
 * anything.
 */
class FolderAdapter extends Adapter {
  static id = 'folder';
  static label = 'Local folder';
  static description =
    'Point at any local folder and swipe through its files. Rejected files move to a trash folder, never deleted outright.';

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
      default: 'jpg,jpeg,png,gif,webp,heic,bmp',
      placeholder: 'jpg,jpeg,png,gif,webp,heic,bmp',
    },
    { key: 'trashDirName', label: 'Trash folder name', type: 'text', default: '.swipeanything-trash' },
  ];

  static actions = [
    { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right' },
    { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true },
    // Down = next without deciding (skip). Up = undo/go back (handled in the UI, not an action).
    { id: 'skip', label: 'Skip', key: 'ArrowDown', direction: 'down' },
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
  }

  async init() {
    const stat = await fsp.stat(this.folderPath).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Folder not found: ${this.folderPath}`);
    }
    await fsp.mkdir(this.trashDir, { recursive: true });
  }

  async _walk(dir, relativeBase = '') {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue; // skips dotfiles and our own trash dir
      const abs = path.join(dir, entry.name);
      const rel = relativeBase ? path.join(relativeBase, entry.name) : entry.name;
      if (entry.isDirectory()) {
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

  async applyAction(item, actionId) {
    if (actionId === 'reject') {
      const from = this._absoluteFor(item.id);
      const to = path.join(this.trashDir, `${Date.now()}__${path.basename(from)}`);
      await fsp.rename(from, to);
      return { type: 'move', from, to };
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
    return this.folderPath;
  }
}

module.exports = { FolderAdapter };
