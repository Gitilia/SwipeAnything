'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listZipEntries, formatZipListing } = require('../lib/zip-list');

function writeTinyZip(dir) {
  // Minimal hand-rolled store-method zip with two files (no compression).
  // Local file headers + central directory + EOCD.
  function local(name, data) {
    const n = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version
    header.writeUInt16LE(0, 6); // flags
    header.writeUInt16LE(0, 8); // store
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0, 14); // crc ignored for our reader
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(n.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, n, data]);
  }
  function central(name, data, localOffset) {
    const n = Buffer.from(name);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(0, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(n.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(localOffset, 42);
    return Buffer.concat([header, n]);
  }

  const a = Buffer.from('alpha\n');
  const b = Buffer.from('item,qty\n1,2\n');
  const locA = local('readme.txt', a);
  const locB = local('data/rows.csv', b);
  const body = Buffer.concat([locA, locB]);
  const cen = Buffer.concat([
    central('readme.txt', a, 0),
    central('data/rows.csv', b, locA.length),
  ]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(2, 8);
  eocd.writeUInt16LE(2, 10);
  eocd.writeUInt32LE(cen.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  eocd.writeUInt16LE(0, 20);

  const zipPath = path.join(dir, 'sample.zip');
  fs.writeFileSync(zipPath, Buffer.concat([body, cen, eocd]));
  return zipPath;
}

test('listZipEntries reads names and sizes without extracting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-zip-'));
  const zipPath = writeTinyZip(dir);
  const listing = await listZipEntries(zipPath);
  assert.equal(listing.totalEntries, 2);
  assert.equal(listing.truncated, false);
  assert.deepEqual(
    listing.entries.map((e) => e.name),
    ['readme.txt', 'data/rows.csv']
  );
  assert.equal(listing.entries[0].size, 6);
  const text = formatZipListing(listing);
  assert.match(text, /readme\.txt/);
  assert.match(text, /data\/rows\.csv/);
  fs.rmSync(dir, { recursive: true, force: true });
});
