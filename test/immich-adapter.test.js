'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ImmichAdapter } = require('../adapters/immich');

/** Installs a fake global.fetch for the duration of `fn`, then restores it. */
async function withMockFetch(handler, fn) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return handler(url, options);
  };
  try {
    await fn(calls);
  } finally {
    global.fetch = original;
  }
}

function jsonResponse(body, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('init() calls /users/me with the API key header and throws on failure', async () => {
  await withMockFetch(
    () => jsonResponse({}, false, 401),
    async () => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'bad-key' });
      await assert.rejects(() => adapter.init(), /Immich API \/users\/me failed: 401/);
    }
  );

  await withMockFetch(
    () => jsonResponse({ id: 'me' }),
    async (calls) => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'good-key' });
      await adapter.init();
      assert.equal(calls[0].url, 'https://immich.example.com/api/users/me');
      assert.equal(calls[0].options.headers['x-api-key'], 'good-key');
    }
  );
});

test('list() in chronological mode POSTs /search/metadata and maps assets', async () => {
  await withMockFetch(
    (url) => {
      if (String(url).endsWith('/search/metadata')) {
        return jsonResponse({
          assets: {
            items: [
              { id: 'a1', originalFileName: 'a.jpg', type: 'IMAGE', isFavorite: false },
              { id: 'a2', originalFileName: 'b.mov', type: 'VIDEO', isFavorite: true },
            ],
          },
        });
      }
      return jsonResponse({}, false, 404);
    },
    async (calls) => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'k', mode: 'chronological' });
      const items = await adapter.list();
      assert.equal(items.length, 2);
      assert.equal(items[0].previewType, 'image');
      assert.equal(items[1].previewType, 'video');
      const searchCall = calls.find((c) => String(c.url).endsWith('/search/metadata'));
      assert.equal(searchCall.options.method, 'POST');
      assert.deepEqual(JSON.parse(searchCall.options.body), { take: 100, order: 'desc' });
    }
  );
});

test('list() with skipVideos filters out video assets', async () => {
  await withMockFetch(
    () =>
      jsonResponse({
        assets: {
          items: [
            { id: 'a1', originalFileName: 'a.jpg', type: 'IMAGE' },
            { id: 'a2', originalFileName: 'b.mov', type: 'VIDEO' },
          ],
        },
      }),
    async () => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'k', skipVideos: true });
      const items = await adapter.list();
      assert.deepEqual(items.map((i) => i.id), ['a1']);
    }
  );
});

test('list() in random mode GETs /assets/random', async () => {
  await withMockFetch(
    (url) => {
      assert.ok(String(url).includes('/assets/random?count=50'));
      return jsonResponse([{ id: 'r1', originalFileName: 'r.jpg', type: 'IMAGE' }]);
    },
    async () => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'k', mode: 'random', take: 50 });
      const items = await adapter.list();
      assert.equal(items[0].id, 'r1');
    }
  );
});

test('applyAction("reject") trashes the asset; undo restores it', async () => {
  await withMockFetch(
    () => jsonResponse({ ok: true }),
    async (calls) => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'k' });
      const record = await adapter.applyAction({ id: 'asset-1' }, 'reject');
      assert.deepEqual(record, { type: 'trash', assetId: 'asset-1' });
      const deleteCall = calls.find((c) => c.options.method === 'DELETE');
      assert.equal(deleteCall.url, 'https://immich.example.com/api/assets');
      assert.deepEqual(JSON.parse(deleteCall.options.body), { ids: ['asset-1'], force: false });

      await adapter.undo(record);
      const restoreCall = calls.find((c) => String(c.url).endsWith('/trash/restore/assets'));
      assert.deepEqual(JSON.parse(restoreCall.options.body), { ids: ['asset-1'] });
    }
  );
});

test('applyAction("keep"/"skip") makes no API calls', async () => {
  await withMockFetch(
    () => assert.fail('should not call the API for keep/skip'),
    async () => {
      const adapter = new ImmichAdapter({ serverUrl: 'https://immich.example.com', apiKey: 'k' });
      assert.equal(await adapter.applyAction({ id: 'x' }, 'keep'), null);
      assert.equal(await adapter.applyAction({ id: 'x' }, 'skip'), null);
    }
  );
});
