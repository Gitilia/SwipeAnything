# Changelog

All notable changes to this project are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Immich adapter** (`adapters/immich.js`): swipe through a self-hosted
  Immich photo library. Reject moves the asset to Immich's own trash; undo
  restores it. Second reference implementation of the adapter contract,
  demonstrating a remote-API source alongside the local filesystem.
- **Real thumbnails** on macOS via a `qlmanage` (Quick Look)-backed cache
  (`lib/thumbnails.js`), covering HEIC/HEIF images and video poster frames
  for free. Falls back to the original file on any failure/timeout or on
  non-macOS platforms.
- **Native folder picker**: a "Browse…" button next to folder-type settings
  fields opens a real macOS Finder dialog (`POST /api/browse-folder`, via
  `osascript`). Falls back to manual typing elsewhere.
- **Empty trash**: a separate, confirm-guarded action (shown in the header
  once the folder adapter's trash is non-empty) that permanently deletes
  what "Reject" has moved aside. The only place this project deletes
  anything outright.
- **Session resume**: review progress now persists to
  `.swipeanything-session.json` and survives a server restart (and a
  same-folder "Rescan"), as long as the underlying item set hasn't changed.
- **Accessibility pass**: a live region announces "Item X of Y: name" on
  every card change, action buttons get full `aria-label`s (e.g. "Keep,
  right arrow"), the shortcuts dialog traps and restores focus, focus rings
  are visible everywhere, the progress bar is a real
  `role="progressbar"`/`aria-valuenow`, and header actions are `<button>`s
  instead of `<a href="#">`.
- **Test suite** (`test/`, `npm test`) using Node's built-in test runner:
  the folder adapter against real temp directories, the Immich adapter
  against a mocked `fetch`, and the HTTP API end-to-end.
- `password` and `select` settings field types (used by the Immich adapter's
  API key and order fields).

### Changed
- Adapter contract: `resolvePreviewPath(itemId)` replaced with
  `streamPreview(itemId, res)` / `streamThumbnail(itemId, res)`, so adapters
  can serve previews from anywhere (local file, proxied remote fetch, etc.),
  not just a local path handed to `res.sendFile`.
- `server.js` now exports `{ app, start }` instead of calling `app.listen()`
  at import time, and reads its config/session file paths from
  `SWIPEANYTHING_CONFIG_PATH` / `SWIPEANYTHING_SESSION_PATH` when set — both
  needed to make the app testable in-process.

## [0.1.0] - initial version

- Local folder adapter: swipe local files, reject moves to
  `.swipeanything-trash/`, undo restores.
- Pluggable adapter framework (`adapters/base.js`) with a generic,
  schema-driven settings UI.
- Vanilla HTML/CSS/JS swipe UI: drag gestures, keyboard shortcuts
  (keep/reject/skip/undo), visual keep/reject stamps, shortcuts help modal.
- Zero-build-step Node.js + Express server.
