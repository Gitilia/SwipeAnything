'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { Adapter } = require('./base');

const REJECT_PLAYLIST = 'Swipe Rejected (low stars)';

/** Format seconds as m:ss (or h:mm:ss when ≥ 1 hour). */
function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Triage low-rated Navidrome tracks (0–2★ by default): listen, bump stars,
 * skip, or reject. Reject adds the song to a recoverable "Swipe Rejected"
 * playlist (and optionally moves the file when musicRoot is set).
 */
class NavidromeAdapter extends Adapter {
  static id = 'navidrome';
  static label = 'Navidrome';
  static description =
    'Swipe low-rated songs from a Navidrome library. Listen, set 3–5★, skip, or reject (reject playlist + optional quarantine folder).';

  static configSchema = [
    {
      key: 'serverUrl',
      label: 'Server URL',
      type: 'text',
      required: true,
      placeholder: 'https://navi.example.com',
    },
    { key: 'username', label: 'Username', type: 'text', required: true },
    { key: 'password', label: 'Password', type: 'password', required: true },
    {
      key: 'minRating',
      label: 'Include ratings from',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: 'Unrated / 0★' },
        { value: '1', label: '1★' },
        { value: '2', label: '2★' },
      ],
    },
    {
      key: 'maxRating',
      label: 'Include ratings up to',
      type: 'select',
      default: '2',
      options: [
        { value: '0', label: 'Unrated / 0★' },
        { value: '1', label: '1★' },
        { value: '2', label: '2★' },
      ],
    },
    {
      key: 'includeUnderSeconds',
      label: 'Also include any song shorter than (seconds, 0 = off)',
      type: 'number',
      default: 0,
    },
    {
      key: 'take',
      label: 'How many to load per session',
      type: 'number',
      default: 150,
    },
    {
      key: 'musicRoot',
      label: 'Local music root (optional, for file quarantine)',
      type: 'folder',
      required: false,
      placeholder: '/Volumes/music or /mnt/media/music',
    },
    {
      key: 'trashDirName',
      label: 'Quarantine folder name (under music root)',
      type: 'text',
      default: '.swipe-music-trash',
    },
  ];

  static actions = [
    { id: 'keep', label: 'Keep (3★)', key: 'ArrowRight', direction: 'right', group: 'primary' },
    { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true, group: 'primary' },
    { id: 'skip', label: 'Skip', key: 'ArrowDown', direction: 'down', group: 'primary' },
    { id: 'rate3', label: '3★', key: '3', group: 'organize' },
    { id: 'rate4', label: '4★', key: '4', group: 'organize' },
    { id: 'rate5', label: '5★', key: '5', group: 'organize' },
  ];

  constructor(settings) {
    super(settings);
    this.serverUrl = String(settings.serverUrl || '').replace(/\/+$/, '');
    this.username = settings.username || '';
    this.password = settings.password || '';
    this.maxRating = Math.min(2, Math.max(0, Number(settings.maxRating)));
    if (Number.isNaN(this.maxRating)) this.maxRating = 2;
    this.minRating = Math.min(2, Math.max(0, Number(settings.minRating)));
    if (Number.isNaN(this.minRating)) this.minRating = 0;
    if (this.minRating > this.maxRating) this.minRating = this.maxRating;
    this.includeUnderSeconds = Number(settings.includeUnderSeconds) > 0 ? Number(settings.includeUnderSeconds) : 0;
    this.take = Number(settings.take) > 0 ? Number(settings.take) : 150;
    this.musicRoot = settings.musicRoot ? path.resolve(String(settings.musicRoot)) : '';
    this.trashDirName = String(settings.trashDirName || '.swipe-music-trash').replace(/[/\\]/g, '') || '.swipe-music-trash';
    this._token = null;
    this._rejectPlaylistId = null;
    this._byId = new Map();
  }

  _subsonicAuth() {
    const salt = crypto.randomBytes(6).toString('hex');
    const token = crypto.createHash('md5').update(this.password + salt).digest('hex');
    return { u: this.username, t: token, s: salt, v: '1.16.1', c: 'SwipeAnything', f: 'json' };
  }

  async _login() {
    if (!this.serverUrl) throw new Error('Server URL is required');
    if (!this.username || !this.password) throw new Error('Username and password are required');
    let res;
    try {
      res = await fetch(`${this.serverUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.username, password: this.password }),
      });
    } catch (err) {
      throw new Error(`Could not reach Navidrome at ${this.serverUrl}: ${err.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Navidrome login failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    this._token = data.token;
    if (!this._token) throw new Error('Navidrome login returned no token');
    return this._token;
  }

  async _api(pathname, options = {}) {
    if (!this._token) await this._login();
    const url = `${this.serverUrl}${pathname}`;
    let res;
    try {
      res = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'x-nd-authorization': `Bearer ${this._token}`,
          ...(options.headers || {}),
        },
      });
    } catch (err) {
      throw new Error(`Navidrome request failed: ${err.message}`);
    }
    if (res.status === 401) {
      this._token = null;
      await this._login();
      return this._api(pathname, options);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Navidrome ${pathname} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return res;
  }

  async _subsonic(view, params = {}) {
    const auth = this._subsonicAuth();
    const qs = new URLSearchParams({ ...auth, ...params });
    const url = `${this.serverUrl}/rest/${view}?${qs}`;
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`Navidrome Subsonic ${view} failed: ${err.message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Navidrome Subsonic ${view} failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const sub = data['subsonic-response'] || data;
    if (sub.status && sub.status !== 'ok') {
      throw new Error(`Navidrome Subsonic ${view}: ${sub.error?.message || sub.status}`);
    }
    return sub;
  }

  async _ensureRejectPlaylist() {
    const res = await this._api('/api/playlist');
    const playlists = await res.json();
    const existing = (playlists || []).find((p) => p.name === REJECT_PLAYLIST);
    if (existing) {
      this._rejectPlaylistId = existing.id;
      return existing.id;
    }
    const created = await this._api('/api/playlist', {
      method: 'POST',
      body: JSON.stringify({
        name: REJECT_PLAYLIST,
        comment: 'Songs rejected during low-star triage in SwipeAnything. Remove from this playlist to review again.',
        public: false,
      }),
    });
    const body = await created.json();
    this._rejectPlaylistId = body.id;
    return body.id;
  }

  async _rejectedIds() {
    const pid = await this._ensureRejectPlaylist();
    const res = await this._api(`/api/playlist/${pid}/tracks`);
    const tracks = await res.json();
    return new Set((tracks || []).map((t) => t.id));
  }

  /**
   * Load songs with ratings in [minRating, maxRating].
   * Unrated (null) counts as 0 when minRating is 0.
   */
  async _fetchRatingExact(rating) {
    const out = [];
    const page = 200;
    let start = 0;
    for (;;) {
      const res = await this._api(
        `/api/song?_start=${start}&_end=${start + page}&_sort=title&_order=ASC&rating=${rating}&missing=false`
      );
      const total = Number(res.headers.get('X-Total-Count') || 0);
      const batch = await res.json();
      out.push(...(batch || []));
      start += page;
      if (!batch || batch.length === 0 || start >= total) break;
    }
    return out;
  }

  async _fetchUnrated() {
    const out = [];
    const page = 200;
    let start = 0;
    for (;;) {
      const res = await this._api(
        `/api/song?_start=${start}&_end=${start + page}&_sort=rating&_order=ASC&missing=false`
      );
      const total = Number(res.headers.get('X-Total-Count') || 0);
      const batch = await res.json();
      if (!batch || batch.length === 0) break;
      let pastUnrated = false;
      for (const song of batch) {
        if (song.rating != null && Number(song.rating) > 0) {
          pastUnrated = true;
          break;
        }
        out.push(song);
      }
      start += page;
      if (pastUnrated || start >= total) break;
    }
    return out;
  }

  /** Songs shorter than maxSeconds (any rating), shortest first. */
  async _fetchUnderDuration(maxSeconds) {
    const out = [];
    const page = 200;
    let start = 0;
    for (;;) {
      const res = await this._api(
        `/api/song?_start=${start}&_end=${start + page}&_sort=duration&_order=ASC&missing=false`
      );
      const total = Number(res.headers.get('X-Total-Count') || 0);
      const batch = await res.json();
      if (!batch || batch.length === 0) break;
      let past = false;
      for (const song of batch) {
        const dur = Number(song.duration) || 0;
        if (dur <= 0) continue;
        if (dur >= maxSeconds) {
          past = true;
          break;
        }
        out.push(song);
      }
      start += page;
      if (past || start >= total) break;
    }
    return out;
  }

  async _fetchLowRated() {
    const out = [];
    if (this.minRating === 0) {
      out.push(...(await this._fetchUnrated()));
      out.push(...(await this._fetchRatingExact(0)));
    }
    for (let r = Math.max(1, this.minRating); r <= this.maxRating; r += 1) {
      out.push(...(await this._fetchRatingExact(r)));
    }
    return out;
  }

  async init() {
    await this._login();
    await this._ensureRejectPlaylist();
    if (this.musicRoot) {
      const st = await fsp.stat(this.musicRoot).catch(() => null);
      if (!st || !st.isDirectory()) {
        throw new Error(`Music root not found or not a directory: ${this.musicRoot}`);
      }
      await fsp.mkdir(path.join(this.musicRoot, this.trashDirName), { recursive: true });
    }
  }

  async list() {
    const rejected = await this._rejectedIds();
    const byId = new Map();
    for (const song of await this._fetchLowRated()) {
      byId.set(song.id, song);
    }
    if (this.includeUnderSeconds > 0) {
      for (const song of await this._fetchUnderDuration(this.includeUnderSeconds)) {
        byId.set(song.id, song);
      }
    }

    const songs = [...byId.values()].sort((a, b) => {
      const da = Number(a.duration) || 0;
      const db = Number(b.duration) || 0;
      const shortA = this.includeUnderSeconds > 0 && da > 0 && da < this.includeUnderSeconds ? 0 : 1;
      const shortB = this.includeUnderSeconds > 0 && db > 0 && db < this.includeUnderSeconds ? 0 : 1;
      if (shortA !== shortB) return shortA - shortB;
      // Known short first; unknown duration (0/missing) last within a band
      const knownA = da > 0 ? 0 : 1;
      const knownB = db > 0 ? 0 : 1;
      if (shortA === 0 && knownA !== knownB) return knownA - knownB;
      const ra = a.rating == null ? -1 : Number(a.rating);
      const rb = b.rating == null ? -1 : Number(b.rating);
      if (ra !== rb) return ra - rb;
      if (da !== db) return (da || 1e9) - (db || 1e9);
      return String(a.title || '').localeCompare(String(b.title || ''));
    });

    const items = [];
    for (const song of songs) {
      if (rejected.has(song.id)) continue;
      const rating = song.rating == null ? 0 : Number(song.rating);
      const durSec = Number(song.duration) || 0;
      const inRating = rating >= this.minRating && rating <= this.maxRating;
      // duration 0/missing is NOT "short" — bad tags, not under-a-minute tracks
      // Short tracks are included at any rating. The rating window only
      // applies to the normal queue, not the under-duration union.
      const shortOk =
        this.includeUnderSeconds > 0 &&
        durSec > 0 &&
        durSec < this.includeUnderSeconds;
      if (!inRating && !shortOk) continue;

      this._byId.set(song.id, song);
      const dur = durSec > 0 ? formatDuration(durSec) : undefined;
      items.push({
        id: song.id,
        title: song.title || song.path || song.id,
        subtitle: [song.artist, song.album].filter(Boolean).join(' — ') || undefined,
        previewType: 'audio',
        meta: {
          rating: song.rating == null ? 'unrated' : `${rating}★`,
          ...(dur ? { duration: dur } : {}),
          year: song.year || undefined,
          path: song.path || undefined,
        },
      });
      if (items.length >= this.take) break;
    }
    return items;
  }

  async streamPreview(itemId, res, req) {
    const auth = this._subsonicAuth();
    const qs = new URLSearchParams({ ...auth, id: itemId });
    const url = `${this.serverUrl}/rest/stream.view?${qs}`;
    const headers = {};
    const range = req && req.headers && req.headers.range;
    if (range) headers.Range = range;
    let upstream;
    try {
      upstream = await fetch(url, { headers });
    } catch {
      return false;
    }
    // 200 full body or 206 partial (needed so <audio> can scrub)
    if (!(upstream.status === 200 || upstream.status === 206) || !upstream.body) return false;
    res.status(upstream.status);
    const type = upstream.headers.get('content-type') || 'audio/mpeg';
    res.set('Content-Type', type);
    res.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    res.set('Cache-Control', 'no-store');
    const len = upstream.headers.get('content-length');
    if (len) res.set('Content-Length', len);
    const cr = upstream.headers.get('content-range');
    if (cr) res.set('Content-Range', cr);
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.on('error', () => {
      if (!res.headersSent) res.status(502);
      res.end();
    });
    res.on('close', () => {
      nodeStream.destroy();
    });
    nodeStream.pipe(res);
    return true;
  }

  async streamThumbnail() {
    return false;
  }

  async getDetails(itemId) {
    const song = this._byId.get(itemId);
    if (!song) return { fields: [], actions: [] };
    const fields = [
      { label: 'Artist', value: song.artist },
      { label: 'Album', value: song.album },
      { label: 'Title', value: song.title },
      { label: 'Rating', value: song.rating == null ? '0 (unrated)' : `${song.rating}★` },
      { label: 'Duration', value: song.duration != null ? formatDuration(song.duration) : undefined },
      { label: 'Year', value: song.year },
      { label: 'Path', value: song.path },
      { label: 'Id', value: song.id },
    ];
    return { fields: fields.filter((f) => f.value != null && f.value !== ''), actions: [] };
  }

  uiHints() {
    return { showDetailsByDefault: true, supportsDetails: true };
  }

  async _setRating(songId, rating) {
    await this._subsonic('setRating.view', { id: songId, rating: String(rating) });
  }

  async _addToRejectPlaylist(songId) {
    const pid = await this._ensureRejectPlaylist();
    await this._subsonic('updatePlaylist.view', { playlistId: pid, songIdToAdd: songId });
  }

  async _removeFromRejectPlaylist(songId) {
    const pid = await this._ensureRejectPlaylist();
    const res = await this._api(`/api/playlist/${pid}/tracks`);
    const tracks = await res.json();
    const index = (tracks || []).findIndex((t) => t.id === songId);
    if (index < 0) return;
    await this._subsonic('updatePlaylist.view', {
      playlistId: pid,
      songIndexToRemove: String(index),
    });
  }

  async _quarantineFile(song) {
    if (!this.musicRoot || !song.path) return null;
    const src = path.join(this.musicRoot, song.path);
    try {
      await fsp.access(src);
    } catch {
      return null;
    }
    const trashRoot = path.join(this.musicRoot, this.trashDirName);
    const dest = path.join(trashRoot, song.path);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(src, dest);
    return { src, dest };
  }

  async _restoreFile(move) {
    if (!move) return;
    await fsp.mkdir(path.dirname(move.src), { recursive: true });
    await fsp.rename(move.dest, move.src);
  }

  async applyAction(item, actionId) {
    const song = this._byId.get(item.id) || { id: item.id };
    if (actionId === 'skip') return null;

    if (actionId === 'keep' || actionId === 'rate3') {
      const prev = song.rating == null ? 0 : Number(song.rating);
      await this._setRating(item.id, 3);
      return { type: 'rate', songId: item.id, prev, next: 3 };
    }
    if (actionId === 'rate4') {
      const prev = song.rating == null ? 0 : Number(song.rating);
      await this._setRating(item.id, 4);
      return { type: 'rate', songId: item.id, prev, next: 4 };
    }
    if (actionId === 'rate5') {
      const prev = song.rating == null ? 0 : Number(song.rating);
      await this._setRating(item.id, 5);
      return { type: 'rate', songId: item.id, prev, next: 5 };
    }
    if (actionId === 'reject') {
      await this._addToRejectPlaylist(item.id);
      const move = await this._quarantineFile(song);
      return { type: 'reject', songId: item.id, move };
    }
    return null;
  }

  async undo(record) {
    if (!record) return;
    if (record.type === 'rate') {
      await this._setRating(record.songId, record.prev);
      return;
    }
    if (record.type === 'reject') {
      await this._removeFromRejectPlaylist(record.songId);
      await this._restoreFile(record.move);
    }
  }

  async describeTrash() {
    if (!this.musicRoot) {
      const rejected = await this._rejectedIds();
      return {
        label: REJECT_PLAYLIST,
        count: rejected.size,
        hint: 'Reject adds songs to a Navidrome playlist (no files deleted). Clear the playlist in Navidrome to restore.',
      };
    }
    const trashRoot = path.join(this.musicRoot, this.trashDirName);
    let count = 0;
    async function walk(dir) {
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) await walk(p);
        else count += 1;
      }
    }
    await walk(trashRoot);
    return { label: this.trashDirName, count };
  }

  async emptyTrash() {
    if (!this.musicRoot) {
      throw new Error('Set a local music root to permanently delete quarantined files. Reject playlist entries are cleared in Navidrome.');
    }
    const trashRoot = path.join(this.musicRoot, this.trashDirName);
    await fsp.rm(trashRoot, { recursive: true, force: true });
    await fsp.mkdir(trashRoot, { recursive: true });
  }

  describeSource() {
    const short =
      this.includeUnderSeconds > 0 ? ` + <${this.includeUnderSeconds}s` : '';
    return `${this.serverUrl} (Navidrome ${this.minRating}–${this.maxRating}★${short})`;
  }
}

module.exports = { NavidromeAdapter, REJECT_PLAYLIST, formatDuration };
