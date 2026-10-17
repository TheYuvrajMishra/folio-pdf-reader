# DESIGN — Folio (working title)

Direction: **editorial, dark-first, animation-led, notebook-ruled.**
Feels like a well-set printed book viewed at night: warm ink on near-black paper, hairline rules like notebook margins, motion that is physical (curl, glide, settle) and never decorative.

---

## 1. Principles

1. **The page is the hero.** Chrome hides by default; nothing competes with the text.
2. **Hairlines, not boxes.** Structure comes from 1 px rules (notebook margins), not cards and shadows.
3. **Motion explains.** Every animation shows cause → effect (page turn follows finger, ruler glides to next line, undo reverses visibly).
4. **One accent.** Ember orange for "you are here / active tool". Everything else is ink on paper.
5. **Zero-dependency discipline.** Icons are inline paths; fonts are bundled TTFs; no UI kit.
6. **Reversible by default.** Anything destructive has Undo, not a confirm dialog.

## 2. Reference board

| Reference | Borrow |
|---|---|
| Apple Books | page-curl feel, bottom scrubber with page preview, quiet chrome |
| Kindle | "continue reading" hero, progress microcopy, immersive tap zones |
| Moon+ Reader | ruler styles, theme depth, auto-scroll modes |
| KOReader | export seriousness, settings depth (but hide it better) |
| Readwise Reader | highlight color UX, annotation side panel, editorial typography |
| Procreate | two/three-finger undo/redo, floating tool wheel |
| GoodNotes / Notability | pen + highlighter toolbar, eraser behavior |
| Things 3 | spring motion polish, sheet transitions |
| Libby | shelf/grid rhythm, clear progress on covers |

Collect screenshots of each into `docs/refs/` before building UI (agent: note this in `DECISIONS.md`, do not invent images).

## 3. Color tokens

Dark is the default and the design baseline.

| Token | Dark (default) | OLED | Sepia | Paper |
|---|---|---|---|---|
| `bg` | `#0B0B0C` | `#000000` | `#F1E7D3` | `#F6F4EE` |
| `surface` | `#141416` | `#0A0A0A` | `#E8DCC3` | `#ECE9E1` |
| `ink` | `#EDEAE3` | `#EDEAE3` | `#2A2218` | `#141414` |
| `ink-muted` | `#8C8981` | `#7F7C75` | `#6E6150` | `#6B6963` |
| `rule` (hairline) | `#26262A` | `#1A1A1C` | `#CDBE9F` | `#D6D2C6` |
| `accent` (ember) | `#FF5A36` | `#FF5A36` | `#C8431F` | `#D9441E` |
| `danger` | `#FF4D4D` | same | `#B3261E` | `#B3261E` |

**Highlight palette** (alpha 0.35 over page, multiply blend on light themes): Yellow `#FFD60A` · Green `#6EE7A0` · Blue `#6CB6FF` · Pink `#FF8FB1` · Orange `#FFA657`.
**Ruler default**: amber `#FFB020` @ 22% fill + 1 px top/bottom rule at 60%. Spotlight dim: `bg` @ 75%.
**PDF page treatment**: Dark theme renders pages through Skia color matrix: invert luminance + hue-rotate 180° (images keep hue), then multiply by `#EDEAE3` to avoid pure white glare. "Original" toggle shows untouched page.

Contrast: `ink` on `bg` ≥ 14:1; `ink-muted` on `bg` ≥ 4.5:1; accent used for fills/lines, not small text on light themes.

## 4. Typography

Bundled via `expo-font` (TTF in `assets/fonts`, no runtime network).

| Role | Font | Use |
|---|---|---|
| Display / titles | **Instrument Serif** | library hero, book titles, empty states |
| UI text | **Inter** (400/500/600) | buttons, labels, sheets |
| Mono / meta | **JetBrains Mono** (400/500) | page numbers, percentages, line indices, timestamps |

Scale (sp): 11 / 13 / 15 / 17 / 22 / 28 / 40. UI line-height 1.4; titles 1.1. Letter-spacing on mono meta +0.4. Respect system font scale up to 1.3× in UI (page content unaffected).

## 5. Layout, rules & shape

- 4 pt grid. Screen gutter 20. Reader chrome gutter 16.
- **Notebook margins:** a 1 px vertical rule at x = 20 (left gutter) runs the full height of Library and Sheets; 1 px horizontal rules separate sections/rows. Rules are `rule` color, never shadows.
- Radii: surfaces 0–2 (editorial, sharp); floating controls (ruler pill, tool wheel, chips) fully rounded (999).
- Elevation: none. Floating controls use `surface` + 1 px `rule` border + subtle backdrop (opaque in OLED).
- Touch targets ≥ 48 dp; floating ruler buttons 56 dp.
- Cover thumbnails: 2:3, 1 px `rule` border, progress as a 2 px ember line along the bottom edge.

## 6. Screens

### 6.1 Library
```
│ FOLIO                          ⌕   ⋯ │   ← hairline under header
│─────────────────────────────────────│
│ continue                             │
│ ┌──────────┐  Designing Data-        │
│ │  cover   │  Intensive Apps         │   Instrument Serif 28
│ │          │  p.124 / 612 · 20%      │   mono 13
│ └──────────┘  line 7 · "the quick…"  │   ink-muted
│ [ resume ▸ ]                         │   ember outline button
│─────────────────────────────────────│
│ shelf                       grid|list│
│ ┌────┐ ┌────┐ ┌────┐                 │
│ │    │ │    │ │    │                 │
│ └────┘ └────┘ └────┘                 │
│                              ( + )   │   FAB: Import
```
- Empty state: large serif line "Nothing on the shelf." + "Import a PDF" button; faint ruled-paper background.
- Import: bottom sheet (file picker / paste path not needed). Progress shown on the card itself (thin ember line).

### 6.2 Reader (immersive)
```
(chrome hidden)                (chrome shown)
┌──────────────────┐          ┌──────────────────┐
│                  │          │ ←  Title    ⌕ ⚑ ⋯│ hairline
│                  │          │                  │
│   page canvas    │          │   page canvas    │
│  ═══ruler band═══│          │  ═══ruler band═══│
│                  │          │                  │
│                  │          │ ──●────────────  │ scrubber + preview bubble
└──────────────────┘          │ ✎  ═  ◐  ☰   124 │ toolbar: annotate · ruler · theme · contents · page
                              └──────────────────┘
```
- Tap center toggles chrome (fade 180 ms). Auto-hides after 3 s idle when ruler/annotate inactive.
- Status text bottom-center when chrome hidden: mono 11 `124 / 612` at 40% opacity.

### 6.3 Ruler controls
Floating vertical pill on the right edge (swap sides by dragging): `▲` / `▼` 56 dp buttons, a small line counter `07` in mono between them, and a drag grip. Long-press ▲/▼ repeats. Pill fades to 35% opacity after 2 s idle; any touch restores.
Ruler settings sheet: style (band / spotlight / underline), color, lines (1–3), opacity, glide, haptics, "skip headers/footers".

### 6.4 Annotate mode
Bottom toolbar swaps to: `highlight · underline · strike · pen · note · eraser · select`, then color dots, then **`↶ undo` `↷ redo` always visible** (disabled state when nothing to undo/redo). Active tool has ember underline rule. Tool options (pen width, opacity) in a compact popover above the toolbar.
Two-finger tap = undo, three-finger tap = redo (annotate mode only; hint shown once).

### 6.5 Contents sheet (tabs)
`Contents · Bookmarks · Highlights · Pages` — full-height sheet with notebook margin rule; Highlights tab lists each annotation as: mono `p.124`, color chip, excerpt in serif 15, note in sans italic; swipe-left = delete (with Undo snackbar), tap = jump + pulse the annotation. Header action: Export.

### 6.6 Search
Top input replaces title bar; results as rows with mono page number + snippet with match in ember. Next/prev match arrows; matches highlighted on page.

### 6.7 Settings
Sections separated by hairlines: Reading (default animation, tap zones, keep awake, orientation) · Ruler defaults · Theme · Storage (cache size, clear cache, backup/restore, clear undo history) · About. No toggles that need explanation without a one-line helper text.

### 6.8 Stats (P1)
Serif big number ("14 day streak"), weekly bars (Skia, 1 px rules as grid), goal ring replaced by a thin horizontal progress rule.

## 7. Motion spec

Reduced motion (system "Remove animations" or in-app setting) → all transitions become 120 ms fades; page animation = None.

| Interaction | Spec |
|---|---|
| Page curl | finger-follow (1:1), commit threshold 35% or fling > 800 px/s; settle spring `{damping: 20, stiffness: 180, mass: 1}` ≈ 420 ms; back-face tinted 12% darker; soft shadow along curl line |
| Page slide | outgoing page translates 30% with 0.9→1 dim, incoming 100%; 280 ms `cubic-bezier(0.2, 0.8, 0.2, 1)` |
| Page fade | 180 ms linear |
| Chrome show/hide | opacity + 8 px translate, 180 ms ease-out |
| Ruler step | band glides to next line: spring `{damping: 22, stiffness: 320}` ≈ 120 ms; light haptic tick (if on) |
| Ruler cross-page | page turn runs with chosen style; band appears on first line after settle with 140 ms fade-in |
| Book open | cover shared-element scales up to page 1 (320 ms), library fades |
| Annotation add | highlight "ink-in" wipe left→right 160 ms; pen is live |
| Undo / redo | affected annotation fades out/in 140 ms; page scrolls to it if off-screen |
| Sheets | slide-up 260 ms spring, backdrop 40% scrim |
| List entrance | stagger 40 ms, translateY 12 → 0, opacity 0 → 1 |
| Resume chip | slide-down 200 ms, hold 2.5 s, fade 200 ms |

All animations run on the UI thread (Reanimated worklets / Skia shared values); no JS-thread-driven frame updates.

## 8. Gestures map

| Context | Gesture | Action |
|---|---|---|
| Reader | tap L/R 30% | prev / next page |
| Reader | tap center | toggle chrome |
| Reader | horizontal drag | page turn (follows finger) |
| Reader | pinch / double-tap | zoom (double-tap toggles fit-width ↔ 2.5×) |
| Reader (zoomed) | drag | pan |
| Reader | long-press center | toggle ruler |
| Ruler | tap ▲ / ▼ | step line (hold = repeat) |
| Ruler | drag band | free move, snaps to line on release |
| Annotate | long-press text | start text selection |
| Annotate | two-finger tap / three-finger tap | undo / redo |
| Scrubber | drag | scrub with thumbnail preview + haptic tick per 10 pages |
| Library | long-press card | context menu (rename, reset progress, delete) |

## 9. Components (build list)

`PageCanvas`, `CurlShader`, `RulerBand`, `RulerPill`, `Scrubber`, `ChromeBar`, `ToolWheel/Toolbar`, `ColorDots`, `UndoRedoButtons`, `Sheet`, `Hairline`, `BookCard`, `ProgressRule`, `Chip`, `Snackbar (with Undo)`, `IconButton`, `Icon` (inline SVG paths: back, search, bookmark, more, pen, highlighter, underline, strike, note, eraser, undo, redo, ruler, theme, contents, up, down, plus).

## 10. Icon & brand

Working name **Folio**. Icon: near-black rounded square, a single open-book spread drawn in 1.5 px ink lines, one horizontal **ember** line crossing the right page (the ruler). Wordmark in Instrument Serif, lowercase "folio". Splash: black with the ember line drawing left→right, then the wordmark fades in (600 ms, once).

## 11. Microcopy tone

Short, calm, lowercase labels, serif for emotional moments.
- Resume chip: `Resumed · p.124, line 7`
- Undo snackbar: `Highlight removed · Undo`
- Empty library: `Nothing on the shelf.`
- Import error: `That file didn't open. It may be damaged or protected.`
- Ruler no-text page: `No text on this page. ▼ to skip.`

## 12. Accessibility

- TalkBack labels on every control; ruler ▲/▼ announce "line 7 of 32".
- Contrast per section 3; never encode meaning by color alone (annotation types also have distinct shapes: highlight fill, underline rule, strike line).
- Touch targets ≥ 48 dp; haptics optional.
- Reduce-motion honored (section 7).
- UI scales with system font size; page content has its own zoom.

## 13. Visual QA checklist (per milestone)

- [ ] Hairlines are 1 px physical (use `StyleSheet.hairlineWidth`) on all densities.
- [ ] No pure `#FFF` page glare in dark/OLED.
- [ ] Curl shows no tearing/z-fighting at 60 fps.
- [ ] Ruler band aligns to text baseline ± 1 px at zoom 1×, 2.5×, 5×.
- [ ] Chrome never overlaps ruler pill or annotate toolbar.
- [ ] Every destructive action has Undo.
- [ ] Cutout/notch + gesture-nav insets respected (immersive mode via `expo-navigation-bar`).
