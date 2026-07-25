'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { getAdapter, listAdapters } = require('./adapters/registry');

const app = express();
const PORT = process.env.PORT || 5757;
const CONFIG_PATH = path.join(__dirname, 'swipeanything.config.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/** @type {{ adapterId: string, adapter: import('./adapters/base').Adapter, queue: any[], index: number, history: any[] } | null} */
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

async function startSession(config) {
  const AdapterClass = getAdapter(config.adapter);
  if (!AdapterClass) throw new Error(`Unknown adapter: ${config.adapter}`);
  const adapter = new AdapterClass(config.settings || {});
  await adapter.init();
  const queue = await adapter.list();
  session = { adapterId: config.adapter, adapter, queue, index: 0, history: [] };
  return session;
}

async function ensureSession() {
  if (session) return session;
  const config = loadConfig();
  if (!config) return null;
  return startSession(config);
}

function queuePayload(s) {
  const remaining = s.queue.slice(s.index);
  const counts = {};
  for (const entry of s.history) counts[entry.actionId] = (counts[entry.actionId] || 0) + 1;
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

app.get('/api/queue', async (req, res) => {
  const s = await ensureSession().catch((err) => ({ __error: err }));
  if (!s) return res.status(409).json({ error: 'Not configured yet' });
  if (s.__error) return res.status(400).json({ error: s.__error.message });
  res.json(queuePayload(s));
});

app.post('/api/rescan', async (req, res) => {
  const config = loadConfig();
  if (!config) return res.status(409).json({ error: 'Not configured yet' });
  session = null;
  try {
    const s = await startSession(config);
    res.json(queuePayload(s));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/preview/:itemId', async (req, res) => {
  const s = await ensureSession().catch(() => null);
  if (!s) return res.status(409).end();
  try {
    const filePath = await s.adapter.resolvePreviewPath(req.params.itemId);
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
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
  res.json(queuePayload(s));
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
  res.json(queuePayload(s));
});

app.listen(PORT, () => {
  console.log(`SwipeAnything running at http://localhost:${PORT}`);
});
