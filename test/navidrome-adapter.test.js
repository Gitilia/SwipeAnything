'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NavidromeAdapter, REJECT_PLAYLIST } = require('../adapters/navidrome');

async function withMockFetch(handler, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return handler(String(url), options);
  };
  try {
    await fn(calls);
  } finally {
    global.fetch = original;
  }
}

function jsonResponse(body, ok = true, status = 200, headers = {}) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: {
      get: (name) => {
        const key = String(name).toLowerCase();
        if (key === 'x-total-count' && headers.total != null) return String(headers.total);
        if (key === 'content-type') return 'application/json';
        return headers[key] || null;
      },
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: null,
  };
}

test('init() logs in and ensures reject playlist', async () => {
  await withMockFetch(
    (url, options) => {
      if (url.endsWith('/auth/login')) {
        assert.equal(options.method, 'POST');
        return jsonResponse({ token: 'tok-1' });
      }
      if (url.endsWith('/api/playlist') && (!options.method || options.method === 'GET')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/api/playlist') && options.method === 'POST') {
        const body = JSON.parse(options.body);
        assert.equal(body.name, REJECT_PLAYLIST);
        return jsonResponse({ id: 'pl-reject' });
      }
      return jsonResponse({}, false, 404);
    },
    async () => {
      const adapter = new NavidromeAdapter({
        serverUrl: 'https://navi.example.com',
        username: 'ilia',
        password: 'secret',
      });
      await adapter.init();
      assert.equal(adapter._token, 'tok-1');
      assert.equal(adapter._rejectPlaylistId, 'pl-reject');
    }
  );
});

test('list() loads ≤maxRating songs and skips reject-playlist tracks', async () => {
  await withMockFetch(
    (url) => {
      if (url.endsWith('/auth/login')) return jsonResponse({ token: 't' });
      if (url.endsWith('/api/playlist')) return jsonResponse([{ id: 'pl-reject', name: REJECT_PLAYLIST }]);
      if (url.includes('/api/playlist/pl-reject/tracks')) {
        return jsonResponse([{ id: 'skip-me' }]);
      }
      if (url.includes('/api/song') && url.includes('_sort=rating')) {
        return jsonResponse(
          [
            { id: 'unrated', title: 'Bare', artist: 'X', album: 'Y', rating: null, duration: 30 },
            { id: 'skip-me', title: 'Nope', artist: 'A', album: 'B', rating: 1, duration: 10 },
            { id: 'keep-me', title: 'Song', artist: 'Artist', album: 'Album', rating: 1, duration: 120 },
            { id: 'too-high', title: 'Good', artist: 'Z', album: 'Z', rating: 3, duration: 90 },
          ],
          true,
          200,
          { total: 4 }
        );
      }
      return jsonResponse({}, false, 404);
    },
    async () => {
      const adapter = new NavidromeAdapter({
        serverUrl: 'https://navi.example.com',
        username: 'u',
        password: 'p',
        maxRating: '1',
        take: 50,
      });
      await adapter.init();
      const items = await adapter.list();
      assert.equal(items.length, 2);
      assert.equal(items[0].id, 'unrated');
      assert.equal(items[0].meta.rating, 'unrated');
      assert.equal(items[1].id, 'keep-me');
      assert.equal(items[1].previewType, 'audio');
      assert.equal(items[1].meta.rating, '1★');
      assert.match(items[1].subtitle, /Artist/);
    }
  );
});

test('applyAction rate/keep calls setRating; reject adds to playlist', async () => {
  await withMockFetch(
    (url, options) => {
      if (url.endsWith('/auth/login')) return jsonResponse({ token: 't' });
      if (url.endsWith('/api/playlist')) return jsonResponse([{ id: 'pl-reject', name: REJECT_PLAYLIST }]);
      if (url.includes('/rest/setRating.view')) {
        assert.ok(url.includes('rating=4') || url.includes('rating=3'));
        return jsonResponse({ 'subsonic-response': { status: 'ok' } });
      }
      if (url.includes('/rest/updatePlaylist.view') && url.includes('songIdToAdd')) {
        return jsonResponse({ 'subsonic-response': { status: 'ok' } });
      }
      return jsonResponse({}, false, 404);
    },
    async (calls) => {
      const adapter = new NavidromeAdapter({
        serverUrl: 'https://navi.example.com',
        username: 'u',
        password: 'p',
      });
      adapter._byId.set('s1', { id: 's1', rating: 1, path: 'A/B.mp3' });
      adapter._rejectPlaylistId = 'pl-reject';
      adapter._token = 't';

      const rate = await adapter.applyAction({ id: 's1' }, 'rate4');
      assert.deepEqual(rate, { type: 'rate', songId: 's1', prev: 1, next: 4 });

      const keep = await adapter.applyAction({ id: 's1' }, 'keep');
      assert.equal(keep.next, 3);

      const rejected = await adapter.applyAction({ id: 's1' }, 'reject');
      assert.equal(rejected.type, 'reject');
      assert.ok(calls.some((c) => c.url.includes('songIdToAdd=s1')));
    }
  );
});

test('streamPreview requests Subsonic stream.view for the song id', async () => {
  await withMockFetch(
    (url) => {
      assert.ok(url.includes('/rest/stream.view'));
      assert.ok(url.includes('id=abc'));
      return { ok: true, headers: { get: () => 'audio/flac' }, body: null };
    },
    async () => {
      const adapter = new NavidromeAdapter({
        serverUrl: 'https://navi.example.com',
        username: 'u',
        password: 'p',
      });
      const handled = await adapter.streamPreview('abc', { set() {} });
      assert.equal(handled, false);
    }
  );
});