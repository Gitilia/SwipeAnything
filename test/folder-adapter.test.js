'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FolderAdapter } = require('../adapters/folder');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-test-'));
  fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'hello world');
  fs.writeFileSync(path.join(dir, 'reject-me.txt'), 'bye world');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'nested.txt'), 'nested');
  return dir;
}

test('list() finds top-level files and skips dotfiles/hidden trash dir', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const titles = items.map((i) => i.title).sort();
  assert.deepEqual(titles, ['keep-me.txt', 'reject-me.txt']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('list() with recursive:true includes subfolders', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '', recursive: true });
  await adapter.init();
  const items = await adapter.list();
  assert.ok(items.some((i) => i.title === 'nested.txt' && i.subtitle === 'sub'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('list() filters by extension allowlist', async () => {
  const dir = makeFixture();
  fs.writeFileSync(path.join(dir, 'photo.png'), 'not-really-a-png');
  const adapter = new FolderAdapter({ folderPath: dir, extensions: 'png' });
  await adapter.init();
  const items = await adapter.list();
  assert.deepEqual(items.map((i) => i.title), ['photo.png']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('list() sets previewType for video, audio, csv, pdf, raw, and unknown binary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-preview-'));
  fs.writeFileSync(path.join(dir, 'clip.mp4'), 'fake-mp4-bytes');
  fs.writeFileSync(path.join(dir, 'clip.MOV'), 'fake-mov-bytes'); // case-insensitive
  fs.writeFileSync(path.join(dir, 'song.mp3'), 'fake-mp3-bytes');
  fs.writeFileSync(path.join(dir, 'rows.csv'), 'a,b\n1,2\n');
  fs.writeFileSync(path.join(dir, 'scan.pdf'), '%PDF-1.0');
  fs.writeFileSync(path.join(dir, 'shot.dng'), 'fake-dng');
  fs.writeFileSync(path.join(dir, 'shot.CR2'), 'fake-cr2');
  fs.writeFileSync(path.join(dir, 'bundle.zip'), 'PK\x03\x04');
  fs.writeFileSync(path.join(dir, 'sheet.xlsx'), 'PK\x03\x04-not-really-xlsx');
  fs.writeFileSync(path.join(dir, 'photo.webp'), 'fake-webp');

  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const byTitle = Object.fromEntries((await adapter.list()).map((i) => [i.title, i.previewType]));

  assert.equal(byTitle['clip.mp4'], 'video');
  assert.equal(byTitle['clip.MOV'], 'video');
  assert.equal(byTitle['song.mp3'], 'audio');
  assert.equal(byTitle['rows.csv'], 'text');
  assert.equal(byTitle['scan.pdf'], 'pdf');
  assert.equal(byTitle['shot.dng'], 'image');
  assert.equal(byTitle['shot.CR2'], 'image');
  assert.equal(byTitle['bundle.zip'], 'archive');
  assert.equal(byTitle['photo.webp'], 'image');
  // Excel is a zip container — no in-browser preview yet (generic card).
  assert.equal(byTitle['sheet.xlsx'], 'none');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('reject moves the file to the trash dir, undo restores it', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const target = items.find((i) => i.title === 'reject-me.txt');

  const record = await adapter.applyAction(target, 'reject');
  assert.equal(record.type, 'move');
  assert.ok(!fs.existsSync(path.join(dir, 'reject-me.txt')));
  assert.ok(fs.existsSync(record.to));

  const trash = await adapter.describeTrash();
  assert.equal(trash.count, 1);

  await adapter.undo(record);
  assert.ok(fs.existsSync(path.join(dir, 'reject-me.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('keep and skip have no filesystem effect', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const target = items[0];
  const keepRecord = await adapter.applyAction(target, 'keep');
  const skipRecord = await adapter.applyAction(target, 'skip');
  assert.equal(keepRecord, null);
  assert.equal(skipRecord, null);
  assert.ok(fs.existsSync(path.join(dir, target.title)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('emptyTrash permanently deletes trashed files', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const target = items.find((i) => i.title === 'reject-me.txt');
  await adapter.applyAction(target, 'reject');
  assert.equal((await adapter.describeTrash()).count, 1);
  await adapter.emptyTrash();
  assert.equal((await adapter.describeTrash()).count, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('streamPreview rejects item ids that escape the folder', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const evilId = Buffer.from('../../etc/passwd').toString('base64url');
  const fakeRes = { sendFile: () => assert.fail('should not have sent a file'), type: () => {} };
  await assert.rejects(() => adapter.streamPreview(evilId, fakeRes), /Invalid item id/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('streamPreview serves an existing file via res.sendFile', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const target = items[0];
  let sentPath = null;
  const fakeRes = { sendFile: (p) => (sentPath = p), type: () => {} };
  const handled = await adapter.streamPreview(target.id, fakeRes);
  assert.equal(handled, true);
  assert.equal(sentPath, path.join(dir, target.title));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('init() throws a clear error for a missing folder', async () => {
  const adapter = new FolderAdapter({ folderPath: '/definitely/does/not/exist' });
  await assert.rejects(() => adapter.init(), /Folder not found/);
});

test('getActions() adds organize actions only for configured destination keys', async () => {
  const dir = makeFixture();
  const destA = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-dest-a-'));
  const destB = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-dest-b-'));
  const adapter = new FolderAdapter({
    folderPath: dir,
    extensions: '',
    destinations: {
      1: { path: destA, label: 'Vacation' },
      7: destB,
    },
  });
  await adapter.init();
  const actions = adapter.getActions();
  assert.ok(actions.some((a) => a.id === 'keep'));
  assert.ok(actions.some((a) => a.id === 'move-1' && a.label === 'Vacation' && a.key === '1'));
  assert.ok(actions.some((a) => a.id === 'move-7' && a.key === '7'));
  assert.equal(actions.filter((a) => a.group === 'organize').length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(destA, { recursive: true, force: true });
  fs.rmSync(destB, { recursive: true, force: true });
});

test('move-N moves the file into the destination folder and undo restores it', async () => {
  const dir = makeFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-dest-'));
  const adapter = new FolderAdapter({
    folderPath: dir,
    extensions: '',
    destinations: { 2: { path: dest, label: 'Work' } },
  });
  await adapter.init();
  const items = await adapter.list();
  const target = items.find((i) => i.title === 'keep-me.txt');
  const record = await adapter.applyAction(target, 'move-2');
  assert.equal(record.type, 'move');
  assert.equal(record.destKey, '2');
  assert.ok(!fs.existsSync(path.join(dir, 'keep-me.txt')));
  assert.ok(fs.existsSync(path.join(dest, 'keep-me.txt')));
  await adapter.undo(record);
  assert.ok(fs.existsSync(path.join(dir, 'keep-me.txt')));
  assert.ok(!fs.existsSync(path.join(dest, 'keep-me.txt')));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dest, { recursive: true, force: true });
});

test('list() skips destination folders that sit inside the source tree', async () => {
  const dir = makeFixture();
  const nestedDest = path.join(dir, 'sorted');
  fs.mkdirSync(nestedDest);
  fs.writeFileSync(path.join(nestedDest, 'already-sorted.txt'), 'done');
  const adapter = new FolderAdapter({
    folderPath: dir,
    extensions: '',
    recursive: true,
    destinations: { 0: { path: nestedDest, label: 'Sorted' } },
  });
  await adapter.init();
  const titles = (await adapter.list()).map((i) => i.title);
  assert.ok(!titles.includes('already-sorted.txt'));
  assert.ok(titles.includes('keep-me.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('move-N refuses an unconfigured key', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '', destinations: {} });
  await adapter.init();
  const items = await adapter.list();
  await assert.rejects(() => adapter.applyAction(items[0], 'move-3'), /No destination configured/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('getDetails() returns path, size, and type fields', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '' });
  await adapter.init();
  const items = await adapter.list();
  const target = items.find((i) => i.title === 'keep-me.txt');
  const details = await adapter.getDetails(target.id);
  const labels = details.fields.map((f) => f.label);
  assert.ok(labels.includes('Path'));
  assert.ok(labels.includes('Size'));
  assert.ok(labels.includes('Type'));
  assert.equal(details.path, path.join(dir, 'keep-me.txt'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uiHints() reflects showDetailsByDefault', async () => {
  const dir = makeFixture();
  const adapter = new FolderAdapter({ folderPath: dir, extensions: '', showDetailsByDefault: true });
  await adapter.init();
  assert.deepEqual(adapter.uiHints(), { showDetailsByDefault: true, supportsDetails: true });
  fs.rmSync(dir, { recursive: true, force: true });
});
