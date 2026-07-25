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

     // Optional: override the default keep/reject pair, e.g. add a third
     // "later" action. Each needs a distinct key and direction.
     static actions = [
       { id: 'keep', label: 'Keep', key: 'ArrowRight', direction: 'right' },
       { id: 'reject', label: 'Reject', key: 'ArrowLeft', direction: 'left', isDestructive: true },
     ];

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

     // Optional, only if items have a file-like preview:
     async resolvePreviewPath(itemId) {
       return null;
     }

     describeSource() {
       return ''; // short string shown in the UI header
     }
   }

   module.exports = { YourAdapter };
   ```

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

## Pull requests

Keep adapters self-contained in their own file. Include a short section in
the PR description covering: what it swipes through, what each action does,
and how undo works.
