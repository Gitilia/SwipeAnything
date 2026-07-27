# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** SwipeAnything  
**Updated:** 2026-07-26  
**Category:** Local media / file triage utility  
**Source:** ui-ux-pro-max search (curated — auto-match rejected)

---

## Why this system (not the auto pick)

`search.py --design-system` suggested **Vibrant & Block-based** + rose light palette
(`#FFF1F2` / `#E11D48`) and Inter — a social-media landing pattern. Wrong product.

**Curated from skill DB instead:**
- **Style:** Dark Mode (OLED) — deep black / dark grey, high contrast, minimal glow
- **Color notes:** Podcast / financial-dashboard dark rows (dark bg + warm/cool accent)
- **Typography:** DM Sans + IBM Plex Mono (not Inter — avoids AI-default stack)
- **UX:** keyboard-first, visible focus, overlay sheets (no layout jump), WCAG contrast

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Background | `#0a0a0b` | `--bg` |
| Surface | `#141416` | `--card` |
| Surface raised | `#1a1a1e` | `--card2` |
| Text | `#f4f4f5` | `--text` |
| Muted text | `#a1a1aa` | `--sub` |
| Accent / CTA | `#38bdf8` | `--accent` |
| Keep | `#34d399` | `--keep` |
| Reject | `#fb7185` | `--reject` |
| Skip / warn | `#fbbf24` | `--neutral` |
| Border | `#27272a` | `--border` |

**Color notes:** OLED-safe near-black; semantic keep/reject/skip stay color+label (not color-only).

### Typography

- **UI / headings:** DM Sans
- **Paths, keys, meta values:** IBM Plex Mono
- **Mood:** Quiet utility, high legibility at night

### Motion

- Transitions: `150–200ms` ease
- Respect `prefers-reduced-motion`
- Details sheet: rise + backdrop fade (already present)
- No neon glow / glitch / maximalism

### Spacing

| Token | Value |
|-------|-------|
| `--space-xs` | `4px` |
| `--space-sm` | `8px` |
| `--space-md` | `16px` |
| `--space-lg` | `24px` |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 12px 40px rgba(0,0,0,0.55)` | Deck card |
| `--shadow-sheet` | `0 -16px 48px rgba(0,0,0,0.55)` | Details sheet |

---

## Component Specs

### Deck card
- Max width ~400px, radius 20px, border 1px `--border`
- Preview media edge-to-edge in rounded well
- Title clickable → details sheet

### Action buttons
- Circular primary actions; labels + key glyphs (not color alone)
- `cursor: pointer`; hover border → accent/keep/reject

### Details
- Fixed bottom sheet over dimmed backdrop (no document reflow)
- Mono for path values; uppercase muted labels

### Header chips
- Compact bordered pills; hover → text primary

---

## Pre-Delivery Checklist (from skill)

- [x] No emoji-as-icons for critical actions (key glyphs OK)
- [x] `cursor: pointer` on clickable controls
- [x] Hover transitions ~150–200ms
- [x] Dark text contrast high on near-black
- [x] `:focus-visible` rings
- [x] `prefers-reduced-motion` respected on sheet
- [x] Narrow column works at ~375px
