'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { getAdapter, listAdapters } = require('./adapters/registry');

const app = express();
const PORT = process.env.PORT || 5757;
// Overridable so the test suite (and anyone running multiple instances) can
// point at an isolated config/session file instead of the project's own.
const CONFIG_PATH = process.env.SWIPEANYTHING_CONFIG_PATH || path.join(__dirname, 'swipeanything.config.json');
const SESSION_PATH = process.env.SWIPEANYTHING_SESSION_PATH || path.join(__dirname, '.swipeanything-session.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {{ adapterId: string, adapter: import('./adapters/base').Adapter, queue: any[], index: number, history: any[], configSignature: string } | null} */
let session = null;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function loadSavedSession() {
  if (!fs.existsSync(SESSION_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function persistSession(s) {
  try {
    fs.writeFileSync(
      SESSION_PATH,
      JSON.stringify({
        configSignature: s.configSignature,
        itemIds: s.queue.map((item) => item.id),
        index: s.index,
        history: s.history,
      })
    );
  } catch {
    // best-effort; a failed write just means we won't resume after a restart
  }
}

function arraysEqual(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
}

async function startSession(config) {
  const AdapterClass = getAdapter(config.adapter);
  if (!AdapterClass) throw new Error(`Unknown adapter: ${config.adapter}`);
  const adapter = new AdapterClass(config.settings || {});
  await adapter.init();
  const queue = await adapter.list();
  const configSignature = JSON.stringify(config);

  session = { adapterId: config.adapter, adapter, queue, index: 0, history: [], configSignature };

  // Resume progress if this is the same config reviewing the same items as
  // last time the server ran (e.g. after a restart, or a Rescan that found
  // no changes). If the item set changed, this naturally falls through to
  // a fresh session instead.
  const saved = loadSavedSession();
  if (saved && saved.configSignature === configSignature && arraysEqual(saved.itemIds, queue.map((i) => i.id))) {
    session.index = saved.index;
    session.history = saved.history;
  }

  persistSession(session);
  return session;
}

async function ensureSession() {
  if (session) return session;
  const config = loadConfig();
  if (!config) return null;
  return startSession(config);
}

async function queuePayload(s) {
  const remaining = s.queue.slice(s.index);
  const counts = {};
  for (const entry of s.history) counts[entry.actionId] = (counts[entry.actionId] || 0) + 1;
  const trashInfo = await s.adapter.describeTrash().catch(() => null);
  return {
    adapterId: s.adapterId,
    sourceLabel: s.adapter.describeSource(),
    actions: s.adapter.constructor.actions,
    total: s.queue.length,
    reviewed: s.index,
    counts,
    current: remaining[0] || null,
    upcoming: remaining.slice(1, 4),
    canUndo: s.history.length > 0,
    trashInfo,
  };
}

app.get('/api/adapters', (req, res) => {
  res.json(listAdapters());
});

app.get('/api/config', (req, res) => {
  res.json({ config: loadConfig() });
});

app.post('/api/config', async (req, res) => {
  const { adapter, settings } = req.body || {};
  const AdapterClass = getAdapter(adapter);
  if (!AdapterClass) {
    return res.status(400).json({ error: `Unknown adapter: ${adapter}` });
  }
  const config = { adapter, settings: settings || {} };
  try {
    await startSession(config); // validates settings before persisting
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  saveConfig(config);
  res.json({ ok: true });
});

app.post('/api/browse-folder', (req, res) => {
  if (process.platform !== 'darwin') {
    return res.status(501).json({ error: 'Native folder picker is only available on macOS. Enter the path manually.' });
  }
  const script = 'POSIX path of (choose folder with prompt "Select a folder for SwipeAnything")';
  execFile('osascript', ['-e', script], { timeout: 120000 }, (err, stdout) => {
    if (err) {
      const message = /user canceled/i.test(err.message || '') ? 'Cancelled' : err.message;
      return res.status(400).json({ error: message });
    }
    res.json({ path: stdout.trim() });
  });
});

app.get('/api/queue', async (req, res) => {
  const s = await ensureSession().catch((err) => ({ __error: err }));
  if (!s) return res.status(409).json({ error: 'Not configured yet' });
  if (s.__error) return res.status(400).json({ error: s.__error.message });
  res.json(await queuePayload(s));
});

app.post('/api/rescan', async (req, res) => {
  const config = loadConfig();
  if (!config) return res.status(409).json({ error: 'Not configured yet' });
  session = null;
  try {
    const s = await startSession(config);
    res.json(await queuePayload(s));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/preview/:itemId', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).end();
  try {
    const handled = await s.adapter.streamPreview(req.params.itemId, res);
    if (!handled) res.status(404).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/thumbnail/:itemId', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).end();
  try {
    const handled = await s.adapter.streamThumbnail(req.params.itemId, res);
    if (!handled) res.status(404).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/action', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).json({ error: 'Not configured yet' });
  const { itemId, actionId } = req.body || {};
  const item = s.queue[s.index];
  if (!item || item.id !== itemId) {
    return res.status(409).json({ error: 'Item is stale, refresh the queue' });
  }
  const validAction = s.adapter.constructor.actions.some((a) => a.id === actionId);
  if (!validAction) {
    return res.status(400).json({ error: `Unknown action: ${actionId}` });
  }
  let record;
  try {
    record = await s.adapter.applyAction(item, actionId);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  s.history.push({ index: s.index, item, actionId, record: record || null });
  s.index += 1;
  persistSession(s);
  res.json(await queuePayload(s));
});

app.post('/api/undo', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).json({ error: 'Not configured yet' });
  const entry = s.history.pop();
  if (!entry) return res.status(409).json({ error: 'Nothing to undo' });
  try {
    if (entry.record) await s.adapter.undo(entry.record);
  } catch (err) {
    // put the history entry back so the user doesn't lose track of it
    s.history.push(entry);
    return res.status(400).json({ error: err.message });
  }
  s.index = entry.index;
  persistSession(s);
  res.json(await queuePayload(s));
});

app.post('/api/empty-trash', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).json({ error: 'Not configured yet' });
  try {
    await s.adapter.emptyTrash();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json(await queuePayload(s));
});

function start(port = PORT) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
}

if (require.main === module) {
  start().then((server) => {
    console.log(`SwipeAnything running at http://localhost:${server.address().port}`);
  });
}

module.exports = { app, start };
