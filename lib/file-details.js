'use strict';

// Best-effort file details for the "inspect before deciding" panel.
// Uses fs.stat always; on macOS also sips (dimensions) and mdls (camera /
// capture date) when available. Failures are silent — callers get whatever
// we could gather.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const IS_MACOS = process.platform === 'darwin';
const IMAGE_EXT = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'tif',
  'avif',
  // Camera RAW — sips/mdls often still know dimensions / capture metadata on macOS
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'orf',
  'rw2',
  'raf',
  'pef',
  'raw',
  'srw',
]);
const PDF_EXT = new Set(['pdf']);

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

async function sipsDimensions(absPath) {
  if (!IS_MACOS) return null;
  try {
    const { stdout } = await execFileAsync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absPath], {
      timeout: 3000,
      killSignal: 'SIGKILL',
    });
    const width = /pixelWidth:\s*(\d+)/.exec(stdout);
    const height = /pixelHeight:\s*(\d+)/.exec(stdout);
    if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  } catch {
    // ignore
  }
  return null;
}

async function mdlsFields(absPath) {
  if (!IS_MACOS) return {};
  const keys = [
    'kMDItemAcquisitionMake',
    'kMDItemAcquisitionModel',
    'kMDItemContentCreationDate',
    'kMDItemLatitude',
    'kMDItemLongitude',
    'kMDItemOrientation',
    'kMDItemProfileName',
  ];
  try {
    const args = [];
    for (const key of keys) args.push('-name', key);
    args.push(absPath);
    const { stdout } = await execFileAsync('mdls', args, { timeout: 3000, killSignal: 'SIGKILL' });
    const out = {};
    for (const key of keys) {
      const re = new RegExp(`${key}\\s*=\\s*(.+)$`, 'm');
      const match = re.exec(stdout);
      if (!match) continue;
      let value = match[1].trim();
      if (value === '(null)' || value === 'null') continue;
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * @returns {Promise<{ fields: Array<{ label: string, value: string }>, path: string }>}
 */
async function collectFileDetails(absPath) {
  const fields = [];
  const stat = await fsp.stat(absPath);
  const ext = path.extname(absPath).slice(1).toLowerCase();

  fields.push({ label: 'Path', value: absPath });
  fields.push({ label: 'Name', value: path.basename(absPath) });
  if (ext) fields.push({ label: 'Type', value: ext.toUpperCase() });
  fields.push({ label: 'Size', value: `${formatSize(stat.size)} (${stat.size.toLocaleString()} bytes)` });
  fields.push({ label: 'Modified', value: formatDate(stat.mtime) });
  fields.push({ label: 'Created', value: formatDate(stat.birthtime) || formatDate(stat.ctime) });

  if (IMAGE_EXT.has(ext)) {
    const dims = await sipsDimensions(absPath);
    if (dims) fields.push({ label: 'Dimensions', value: `${dims.width} × ${dims.height}` });

    const md = await mdlsFields(absPath);
    if (md.kMDItemAcquisitionMake || md.kMDItemAcquisitionModel) {
      fields.push({
        label: 'Camera',
        value: [md.kMDItemAcquisitionMake, md.kMDItemAcquisitionModel].filter(Boolean).join(' '),
      });
    }
    if (md.kMDItemContentCreationDate) {
      fields.push({ label: 'Captured', value: md.kMDItemContentCreationDate.replace(' +0000', ' UTC') });
    }
    if (md.kMDItemLatitude && md.kMDItemLongitude) {
      fields.push({ label: 'Location', value: `${md.kMDItemLatitude}, ${md.kMDItemLongitude}` });
    }
    if (md.kMDItemProfileName) fields.push({ label: 'Color profile', value: md.kMDItemProfileName });
  }

  if (PDF_EXT.has(ext) && IS_MACOS) {
    const md = await mdlsFields(absPath);
    // Page count shows up under kMDItemNumberOfPages for many PDFs
    try {
      const { stdout } = await execFileAsync('mdls', ['-name', 'kMDItemNumberOfPages', absPath], {
        timeout: 3000,
        killSignal: 'SIGKILL',
      });
      const match = /kMDItemNumberOfPages\s*=\s*(\d+)/.exec(stdout);
      if (match) fields.push({ label: 'Pages', value: match[1] });
    } catch {
      // ignore
    }
    if (md.kMDItemContentCreationDate) {
      fields.push({ label: 'Document date', value: md.kMDItemContentCreationDate.replace(' +0000', ' UTC') });
    }
  }

  return { path: absPath, fields: fields.filter((f) => f.value) };
}

module.exports = { collectFileDetails, formatSize };
