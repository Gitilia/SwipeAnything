# SwipeAnything

Unleash the swipe on anything. Point it at a folder, and (via adapters) at
your inbox, a database table, or whatever else you need to triage — one
card at a time, right = keep, left = reject, like a dating app for your
backlog.

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

v1 ships with one polished adapter — **local folder** — plus the framework
for more. Email, database-row, and other adapters are welcome as
contributions; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- Swipe (touch/mouse drag) or use the keyboard
- Non-destructive by default: "reject" moves files to a `.swipeanything-trash/`
  folder next to the source, never a hard delete
- Undo, any number of steps back
- Live progress + per-action counts
- Generic settings UI: every adapter declares its own config fields and gets
  a form for free — no adapter-specific frontend code required
- Zero build step: Node.js + Express + vanilla HTML/CSS/JS

## Quickstart

```bash
git clone https://git.levkin.ca/ilia/SwipeAnything.git
cd SwipeAnything
npm install
npm start
```

Open `http://localhost:5757`. On first run you'll land on **Settings** —
pick the "Local folder" adapter, point it at a folder, and start swiping.

Alternatively, copy `swipeanything.config.example.json` to
`swipeanything.config.json` and edit it directly:

```bash
cp swipeanything.config.example.json swipeanything.config.json
```

## Controls

| Action | Gesture | Key | Button |
|---|---|---|---|
| Keep | Drag right | `→` | green circle |
| Reject (moves to trash) | Drag left | `←` | red circle |
| Skip (folder adapter) | — | `Space` | circle |
| Undo | — | `Ctrl/Cmd+Z` | Undo |

## How adapters work

Every adapter implements a small contract (`adapters/base.js`): declare a
settings schema, list the items to review, and apply/undo actions on them.
The bundled `adapters/folder.js` is the reference implementation — read it
first, then see [CONTRIBUTING.md](CONTRIBUTING.md) for a full walkthrough of
writing your own (email, database rows, RSS, anything).

```
UI (public/) --> Express API (server.js) --> Adapter Registry --> your adapter
```

## Project layout

```
server.js                          Express app: API + static file serving
adapters/base.js                   Adapter contract every adapter implements
adapters/folder.js                 Reference adapter: local files/folders
adapters/registry.js               Adapter registration
public/                            Vanilla HTML/CSS/JS swipe UI + settings UI
swipeanything.config.example.json  Copy to swipeanything.config.json to configure
```

## Roadmap ideas

- Email adapter (IMAP): swipe archive/delete/label
- Generic JSON/CSV/database-row adapter: swipe to tag or update a status column
- Multi-select "later" bucket as a first-class third action everywhere

## License

MIT, see [LICENSE](LICENSE).
