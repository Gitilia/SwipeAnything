# SwipeAnything

Unleash the swipe on anything. Point it at a folder or a photo library, and
(via adapters) at your inbox, a database table, or whatever else you need to
triage — one card at a time, right = keep, left = reject, like a dating app
for your backlog.

## Why

Tinder-style triage tools already exist, but each one is wired to a single
source: an image folder ([image-tinder](https://github.com/wsamuelw/image-tinder),
[photo-tinder-desktop](https://github.com/relaxis/photo-tinder-desktop)), an
inbox ([SwipeMail](https://github.com/RyanAJensen/SwipeMail)), or an AI
approval queue ([decision-desk](https://github.com/jdubb118/decision-desk)).

SwipeAnything separates the swipe UI from the source. An **adapter** turns
any collection of things into a queue of cards; the UI, keyboard shortcuts,
drag gestures, undo stack, and settings form all work the same regardless of
what's behind them. Write a new adapter and you get the whole UI for free.

## Status

Two adapters ship today — **local folder** and **Immich** (self-hosted photo
library) — proving the framework works for both a filesystem and a remote
API. Email, database-row, and other adapters are welcome as contributions;
see [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- Swipe (touch/mouse drag) or use the keyboard
- Non-destructive by default: "reject" moves files to a `.swipeanything-trash/`
  folder (or, for Immich, the library's own trash) — never a hard delete.
  A separate, confirm-guarded "Empty trash" action is the only place that
  permanently deletes anything.
- Undo, any number of steps back
- Session resume: closing the tab, reloading, or restarting the server picks
  up right where you left off (as long as the underlying items haven't changed)
- Real thumbnails on macOS (via Quick Look), including HEIC/HEIF and video
  poster frames, with automatic fallback to the original file everywhere else
- Native "Browse…" folder picker on macOS; type a path anywhere else
- Live progress + per-action counts
- Generic settings UI: every adapter declares its own config fields and gets
  a form for free — no adapter-specific frontend code required
- Accessible by default: live region announcements per card, labeled action
  buttons, a focus-trapped shortcuts dialog, visible focus rings, and a real
  `role="progressbar"`
- Zero build step: Node.js + Express + vanilla HTML/CSS/JS
- `npm test` runs a real test suite (folder adapter, Immich adapter with a
  mocked API, and the HTTP API end-to-end) — no separate test server to stand up

## Quickstart

```bash
git clone https://git.levkin.ca/ilia/SwipeAnything.git
cd SwipeAnything
npm install
npm start
```

Open `http://localhost:5757`. On first run you'll land on **Settings** —
pick an adapter, fill in its settings, and start swiping.

Alternatively, copy `swipeanything.config.example.json` to
`swipeanything.config.json` and edit it directly:

```bash
cp swipeanything.config.example.json swipeanything.config.json
```

### Running the tests

```bash
npm test
```

Uses Node's built-in test runner (`node --test`) — no extra dev dependencies.
The Immich adapter is tested with a mocked `fetch`, so nothing here needs a
live server.

## Controls

| Action | Gesture | Key | Button |
|---|---|---|---|
| Keep | Drag right | `→` | Keep → |
| Reject (moves to trash) | Drag left | `←` | Reject ← |
| Skip / next (no decision) | — | `↓` or `Space` | Skip ↓ |
| Undo / go back | — | `↑` or `Ctrl/Cmd+Z` | Undo ↑ |
| Shortcuts help | — | `Shift+?` | `?` in header |

Keep/Reject (button or key) flash the KEEP/REJECT stamp and fling the card, same as a drag.

## Adapters

### Local folder

Point at any local folder. Optionally recurse into subfolders and filter by
extension. "Reject" moves the file into `.swipeanything-trash/` next to the
source; "Empty trash" (a separate, confirm-guarded action shown in the header
once there's anything to empty) permanently deletes what's in there.

### Immich

Point at a self-hosted [Immich](https://immich.app) server + API key and
swipe through your photo library newest-first (or randomly). "Reject" moves
the asset to Immich's own trash via the API; "Undo" restores it from there.
This is an early adapter — tested against the documented API shape, not
every Immich version, so please open an issue/PR if something doesn't match
your server.

## How adapters work

Every adapter implements a small contract (`adapters/base.js`): declare a
settings schema, list the items to review, apply/undo actions on them, and
stream a preview/thumbnail. `adapters/folder.js` (local filesystem) and
`adapters/immich.js` (remote API) are two different reference
implementations — read whichever is closer to what you're building, then see
[CONTRIBUTING.md](CONTRIBUTING.md) for a full walkthrough of writing your own
(email, database rows, RSS, anything).

```
UI (public/) --> Express API (server.js) --> Adapter Registry --> your adapter
```

## Project layout

```
server.js                          Express app: API + static file serving
adapters/base.js                   Adapter contract every adapter implements
adapters/folder.js                 Reference adapter: local files/folders
adapters/immich.js                 Reference adapter: remote API (Immich)
adapters/registry.js               Adapter registration
lib/thumbnails.js                  macOS Quick Look-based thumbnail cache
public/                            Vanilla HTML/CSS/JS swipe UI + settings UI
test/                              node:test suite (adapters + HTTP API)
swipeanything.config.example.json  Copy to swipeanything.config.json to configure
```

## Notes on platform-specific features

A few conveniences use macOS system tools instead of adding npm dependencies,
and quietly no-op elsewhere:

- **Thumbnails** use `qlmanage` (Quick Look). Falls back to serving the
  original file if generation fails or times out, or on non-macOS platforms.
- **Folder picker** uses `osascript`/Finder. On other platforms, or if
  automation permission is denied, just type the path into the field instead.

## Roadmap ideas

- Email adapter (IMAP): swipe archive/delete/label
- Generic JSON/CSV/database-row adapter: swipe to tag or update a status column
- Multi-select "later" bucket as a first-class third action everywhere
- Mobile-friendly PWA wrapper

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT, see [LICENSE](LICENSE).
