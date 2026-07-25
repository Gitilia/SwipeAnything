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
