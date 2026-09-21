'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Point the server at a throwaway config/session file before requiring it,
// so this suite never touches the real project config.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-api-test-'));
process.env.SWIPEANYTHING_CONFIG_PATH = path.join(tmpRoot, 'config.json');
process.env.SWIPEANYTHING_SESSION_PATH = path.join(tmpRoot, 'session.json');

const { start } = require('../server');

const folderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swipeanything-api-folder-'));
fs.writeFileSync(path.join(folderDir, 'a.txt'), 'A');
fs.writeFileSync(path.join(folderDir, 'b.txt'), 'B');

let server;
let base;

test.before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.rmSync(folderDir, { recursive: true, force: true });
});

async function api(pathname, options) {
  const res = await fetch(`${base}${pathname}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

test('GET /api/adapters lists the registered adapters', async () => {
  const { status, body } = await api('/api/adapters');
  assert.equal(status, 200);
  assert.ok(body.some((a) => a.id === 'folder'));
  assert.ok(body.some((a) => a.id === 'immich'));
  assert.ok(body.some((a) => a.id === 'navidrome'));
});

test('GET /api/queue returns 409 before configuration', async () => {
  const { status, body } = await api('/api/queue');
  assert.equal(status, 409);
  assert.match(body.error, /Not configured/);
});

test('POST /api/config rejects an unknown adapter', async () => {
  const { status, body } = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ adapter: 'nope', settings: {} }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /Unknown adapter/);
});

test('POST /api/config rejects a missing folder', async () => {
  const { status, body } = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ adapter: 'folder', settings: { folderPath: '/definitely/not/real' } }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /Folder not found/);
});

test('full flow: configure, queue, keep, reject, undo, empty-trash', async () => {
  const configRes = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify({ adapter: 'folder', settings: { folderPath: folderDir, extensions: 'txt' } }),
  });
  assert.equal(configRes.status, 200);

  const queue1 = await api('/api/queue');
  assert.equal(queue1.status, 200);
  assert.equal(queue1.body.total, 2);
  assert.equal(queue1.body.reviewed, 0);
  const first = queue1.body.current;

  const afterKeep = await api('/api/action', {
    method: 'POST',
    body: JSON.stringify({ itemId: first.id, actionId: 'keep' }),
  });
  assert.equal(afterKeep.status, 200);
  assert.equal(afterKeep.body.reviewed, 1);
  assert.equal(afterKeep.body.canUndo, true);
  const second = afterKeep.body.current;

  const afterReject = await api('/api/action', {
    method: 'POST',
    body: JSON.stringify({ itemId: second.id, actionId: 'reject' }),
  });
  assert.equal(afterReject.status, 200);
  assert.equal(afterReject.body.reviewed, 2);
  assert.equal(afterReject.body.current, null);
  assert.equal(afterReject.body.trashInfo.count, 1);

  const afterUndo = await api('/api/undo', { method: 'POST' });
  assert.equal(afterUndo.status, 200);
  assert.equal(afterUndo.body.reviewed, 1);
  assert.equal(afterUndo.body.current.id, second.id);

  // put it back so trash state is predictable for the next assertion
  await api('/api/action', { method: 'POST', body: JSON.stringify({ itemId: second.id, actionId: 'reject' }) });
  const emptied = await api('/api/empty-trash', { method: 'POST' });
  assert.equal(emptied.status, 200);
  assert.equal(emptied.body.trashInfo.count, 0);
});

test('POST /api/action with a stale itemId is rejected', async () => {
  await api('/api/rescan', { method: 'POST' });
  const { status, body } = await api('/api/action', {
    method: 'POST',
    body: JSON.stringify({ itemId: 'not-the-current-item', actionId: 'keep' }),
  });
  assert.equal(status, 409);
  assert.match(body.error, /stale/);
});

test('POST /api/undo with nothing to undo is rejected', async () => {
  await api('/api/rescan', { method: 'POST' });
  const { status, body } = await api('/api/undo', { method: 'POST' });
  assert.equal(status, 409);
  assert.match(body.error, /Nothing to undo/);
});

test('GET /api/preview/:itemId 404s for an unknown item', async () => {
  const missingId = Buffer.from('nonexistent.txt').toString('base64url');
  const res = await fetch(`${base}/api/preview/${missingId}`);
  assert.equal(res.status, 404);
});

test('GET /api/details/:itemId returns file metadata fields', async () => {
  await api('/api/rescan', { method: 'POST' });
  const queue = await api('/api/queue');
  assert.equal(queue.status, 200);
  assert.ok(queue.body.current);
  assert.equal(queue.body.ui.supportsDetails, true);
  const { status, body } = await api(`/api/details/${queue.body.current.id}`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.fields));
  assert.ok(body.fields.some((f) => f.label === 'Path'));
  assert.ok(body.fields.some((f) => f.label === 'Size'));
});
