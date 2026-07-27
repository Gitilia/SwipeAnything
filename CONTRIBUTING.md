# Contributing

Adapters are the whole point of this project — the swipe UI, keyboard
shortcuts, drag gestures, undo stack, and settings form are all generic and
work for any adapter that implements the contract below.

## Writing a new adapter

1. Create `adapters/your-adapter.js` and extend the base class:

   ```js
   const { Adapter } = require('./base');

   class YourAdapter extends Adapter {
     static id = 'your-adapter';           // used in swipeanything.config.json
     static label = 'Your Adapter';        // shown in the settings UI
     static description = 'One line describing what this swipes through.';

     // Settings UI is generated from this — no frontend code needed.
     static configSchema = [
       { key: 'someSetting', label: 'Some setting', type: 'text', required: true },
     ];

     // Optional: override the default keep/reject pair. Prefer getActions()
     // when the set depends on settings (see folder.js destinations 0–9).
     static actions = [
       { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right', group: 'primary' },
       { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true, group: 'primary' },
     ];

     getActions() {
       return this.constructor.actions; // or append setting-driven actions
     }

     async init() {
       // Validate settings / open a connection. Throw a descriptive Error
       // to surface a message in the settings UI.
     }

     async list() {
       // Return the full queue: [{ id, title, subtitle?, previewType?, meta? }]
     }

     async applyAction(item, actionId) {
       // Perform the effect. Return whatever undo() needs, or null/undefined.
     }

     async undo(record) {
       // Reverse applyAction() using the record it returned.
     }

     // Optional: write a full-size preview straight to the Express response.
     // Return true if you handled it, false to let the server 404.
     async streamPreview(itemId, res) {
       return false;
     }

     // Optional: same, but for a smaller/faster thumbnail (used for the
     // card image and as a video poster frame). Falls back to streamPreview
     // in the UI if omitted or it returns false.
     async streamThumbnail(itemId, res) {
       return false;
     }

     // Optional: describe a reversible "trash" so the UI offers a
     // confirm-guarded "Empty trash" action. Return null if you don't have one.
     async describeTrash() {
       return null;
     }

     async emptyTrash() {
       throw new Error('not supported');
     }

     describeSource() {
       return ''; // short string shown in the UI header
     }
   }

   module.exports = { YourAdapter };
   ```

   See `adapters/folder.js` for a local-filesystem implementation (`res.sendFile`
   + a Quick Look thumbnail cache) and `adapters/immich.js` for a remote-API
   implementation (proxying a fetch response straight into `res`) of
   `streamPreview`/`streamThumbnail`.

2. Register it in `adapters/registry.js`:

   ```js
   const { YourAdapter } = require('./your-adapter');

   const ADAPTERS = {
     [FolderAdapter.id]: FolderAdapter,
     [YourAdapter.id]: YourAdapter,
   };
   ```

3. That's it — it now shows up in the Settings page automatically, with a
   generated form from `configSchema`, and the swipe UI works against it.

## Design constraints to keep in mind

- **Non-destructive by default.** Follow the folder adapter's lead: prefer
  "move to a recoverable place" / "mark as read" / "flag a row" over
  irreversible deletes, and make `undo()` actually reverse it.
- **No adapter-specific frontend code.** If you find yourself editing
  `public/app.js` to special-case your adapter, the contract is probably
  missing something generic — open an issue/PR to discuss extending
  `configSchema`, `actions`, or the item shape instead of forking the UI.
- **Validate in `init()`**, not `list()`. Throwing from `init()` surfaces a
  clean error in the settings form before anything gets saved.
- **Keep `list()` fast enough for a session.** It's called once per session
  (or on "Rescan"), not per card — pagination/streaming can come later if
  a real adapter needs it.

## Local development

```bash
npm install
npm start
```

There's no build step — edit files under `public/` or `adapters/` and
refresh the browser.

## Testing

```bash
npm test
```

Runs Node's built-in test runner (`node --test`) against `test/`. No extra
dev dependencies, no separate test server to start.

- `test/folder-adapter.test.js` exercises the filesystem adapter against real
  temp directories (list/reject/undo/emptyTrash/path-traversal guard).
- `test/immich-adapter.test.js` exercises the API-based adapter with
  `global.fetch` mocked out — no live Immich server needed. Follow this
  pattern for other network-backed adapters.
- `test/api.test.js` boots the real Express app (`server.start(0)`) against an
  isolated config/session file (via the `SWIPEANYTHING_CONFIG_PATH` /
  `SWIPEANYTHING_SESSION_PATH` env vars) and drives it over real HTTP.

Please add or extend tests for new adapters and API changes — a fetch-mocked
adapter test is usually enough; you don't need a live backend to contribute one.

## Pull requests

Keep adapters self-contained in their own file. Include a short section in
the PR description covering: what it swipes through, what each action does,
and how undo works.
