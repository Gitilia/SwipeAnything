'use strict';

// Thumbnail generation for the local preview endpoint. Uses macOS's built-in
// Quick Look generator (`qlmanage`) so we get resized previews, video poster
// frames, and HEIC/HEIF support for free -- no extra npm dependencies, no
// native binaries to compile. On non-macOS platforms this silently no-ops
// and callers fall back to serving the original file.

const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CACHE_DIR = path.join(__dirname, '..', '.cache', 'thumbnails');
// qlmanage/quicklookd can hang indefinitely in some environments (headless
// sessions, SSH, sandboxes without WindowServer access). Keep this short and
// always hard-kill on timeout -- worse case is we fall back to the original
// file a little slower, never a hung request.
const GENERATE_TIMEOUT_MS = 3000;
const IS_MACOS = process.platform === 'darwin';

let cacheDirReady = null;
function ensureCacheDir() {
  if (!cacheDirReady) {
    cacheDirReady = fsp.mkdir(CACHE_DIR, { recursive: true });
  }
  return cacheDirReady;
}

function cacheKeyFor(absPath, mtimeMs) {
  return crypto.createHash('sha1').update(`${absPath}:${mtimeMs}`).digest('hex');
}

/**
 * Returns an absolute path to a cached thumbnail PNG for `absPath`, or null
 * if thumbnails aren't supported on this platform / generation failed.
 * Safe to call for any file type; unsupported types just fail fast.
 */
async function getThumbnail(absPath, { size = 480 } = {}) {
  if (!IS_MACOS) return null;

  const stat = await fsp.stat(absPath).catch(() => null);
  if (!stat) return null;

  await ensureCacheDir();
  const key = cacheKeyFor(absPath, stat.mtimeMs);
  const cachedPath = path.join(CACHE_DIR, `${key}.png`);

  if (fs.existsSync(cachedPath)) return cachedPath;

  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'swipeanything-thumb-'));
  try {
    await new Promise((resolve, reject) => {
      const child = execFile(
        'qlmanage',
        ['-t', '-s', String(size), '-o', tmpDir, absPath],
        { timeout: GENERATE_TIMEOUT_MS, killSignal: 'SIGKILL' },
        (err) => (err ? reject(err) : resolve())
      );
      // Belt-and-suspenders: qlmanage/quicklookd have been observed to hang
      // past Node's own `timeout` option in some sandboxed environments.
      const hardKill = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('qlmanage timed out'));
      }, GENERATE_TIMEOUT_MS + 500);
      child.once('exit', () => clearTimeout(hardKill));
    });

    const base = path.basename(absPath);
    const generated = path.join(tmpDir, `${base}.png`);
    if (!fs.existsSync(generated)) return null;

    await fsp.rename(generated, cachedPath);
    return cachedPath;
  } catch {
    return null;
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { getThumbnail, CACHE_DIR };
