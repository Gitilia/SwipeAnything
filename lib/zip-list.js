'use strict';

// Lightweight ZIP central-directory reader — list entry names + sizes without
// extracting. No npm deps. Supports store/deflate archives (standard .zip).
// Not a full unzipper: encrypted, zip64, and split archives are skipped/partial.

const fs = require('fs');
const fsp = fs.promises;

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const MAX_SCAN = 64 * 1024; // EOCD lives in the last 64KiB (+comment)
const MAX_ENTRIES = 200;
const MAX_NAME_BYTES = 1024;

/**
 * @returns {Promise<{ entries: Array<{ name: string, size: number, compressedSize: number, isDir: boolean }>, truncated: boolean, totalEntries: number }>}
 */
async function listZipEntries(absPath) {
  const stat = await fsp.stat(absPath);
  const fd = await fsp.open(absPath, 'r');
  try {
    const scanLen = Math.min(stat.size, MAX_SCAN);
    const tail = Buffer.alloc(scanLen);
    await fd.read(tail, 0, scanLen, stat.size - scanLen);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('Not a zip archive (EOCD not found)');

    const totalEntries = tail.readUInt16LE(eocd + 10);
    const cenSize = tail.readUInt32LE(eocd + 12);
    const cenOffset = tail.readUInt32LE(eocd + 16);

    // Zip64 / huge archives: offsets of 0xffffffff mean we can't parse simply.
    if (cenOffset === 0xffffffff || cenSize === 0xffffffff) {
      throw new Error('Zip64 archives are not supported for listing');
    }

    const cen = Buffer.alloc(cenSize);
    const { bytesRead } = await fd.read(cen, 0, cenSize, cenOffset);
    if (bytesRead !== cenSize) throw new Error('Truncated zip central directory');

    const entries = [];
    let offset = 0;
    let truncated = false;
    while (offset + 46 <= cen.length && entries.length < MAX_ENTRIES) {
      if (cen.readUInt32LE(offset) !== CEN_SIG) break;
      const compressedSize = cen.readUInt32LE(offset + 20);
      const size = cen.readUInt32LE(offset + 24);
      const nameLen = cen.readUInt16LE(offset + 28);
      const extraLen = cen.readUInt16LE(offset + 30);
      const commentLen = cen.readUInt16LE(offset + 32);
      const nameStart = offset + 46;
      const nameEnd = nameStart + Math.min(nameLen, MAX_NAME_BYTES);
      let name = cen.slice(nameStart, nameEnd).toString('utf8');
      // Prefer UTF-8 when the language-encoding flag is set; otherwise still try utf8.
      const isDir = name.endsWith('/');
      entries.push({ name, size, compressedSize, isDir });
      offset = nameStart + nameLen + extraLen + commentLen;
    }
    if (totalEntries > entries.length) truncated = true;

    return { entries, truncated, totalEntries: totalEntries || entries.length };
  } finally {
    await fd.close();
  }
}

function formatZipListing(listing) {
  const lines = [];
  const files = listing.entries.filter((e) => !e.isDir);
  const dirs = listing.entries.filter((e) => e.isDir);
  lines.push(`${listing.totalEntries} entr${listing.totalEntries === 1 ? 'y' : 'ies'} (${files.length} files${dirs.length ? `, ${dirs.length} folders` : ''})`);
  lines.push('');
  for (const entry of listing.entries) {
    if (entry.isDir) {
      lines.push(`  [dir]  ${entry.name}`);
    } else {
      lines.push(`  ${formatSize(entry.size).padStart(8)}  ${entry.name}`);
    }
  }
  if (listing.truncated) lines.push('', `… listing capped at ${MAX_ENTRIES} entries`);
  return lines.join('\n');
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = { listZipEntries, formatZipListing, MAX_ENTRIES };
