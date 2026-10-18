# DESIGN — Folio

Direction: **calm, dark-first, restrained, physical motion.** A well-set book at night: warm ink on near-black paper, one ember accent, whitespace that feels slightly generous, motion that explains cause → effect and never decorates.

---

## 1. Principles

1. **The page is the hero.** Chrome hides by default; nothing competes with the text.
2. **Restraint.** One accent, 2–3 neutrals, one typeface family, one icon set, one radius, one button style, one card style.
3. **Every tap answers instantly.** Press state + haptic in < 100 ms; heavy work happens after the response.
4. **Motion explains.** 150–300 ms, ease-out, no bounce. The eye can always follow where things went.
5. **Reversible by default.** Destructive = Undo snackbar, not a confirm dialog.
6. **Fewer features, each excellent.** Settings stay short; advanced options sit behind one "more" row.

## 2. Reference board

| Reference | Borrow |
|---|---|
| Apple Books | page-curl feel, scrubber with page preview, quiet chrome |
| Kindle | continue-reading hero, progress microcopy, immersive tap zones |
| Moon+ Reader | ruler styles, theme depth |
| KOReader | export seriousness (hide the settings depth better) |
| Readwise Reader | highlight color UX, annotation list, calm typography |
| Procreate | two/three-finger undo/redo, floating tool bar |
| GoodNotes | pen + highlighter toolbar, eraser behavior |
| Things 3 | motion polish, sheet transitions, celebratory micro-moments |
| Linear / Arc mobile | restraint, spacing rhythm, blur + border over shadow |

Agent: do not invent images; record that references were studied by name in `docs/DECISIONS.md`.

## 3. Tokens

### 3.1 Color (one accent, neutrals only otherwise)
| Token | Dark (default) | OLED | Sepia | Paper |
|---|---|---|---|---|
| `bg` | `#0E0E10` | `#000000` | `#F1E7D3` | `#F7F5F0` |
| `surface` | `#171719` | `#0B0B0C` | `#E9DDC5` | `#FFFFFF` |
| `border` | `#2A2A2E` | `#1C1C1F` | `#CDBE9F` | `#E4E0D6` |
| `ink` | `#F1EEE7` | `#F1EEE7` | `#2A2218` | `#161616` |
| `ink-muted` | `#9A968E` | `#8A867F` | `#6E6150` | `#6B6963` |
| `accent` (ember) | `#FF6A45` | `#FF6A45` | `#C4481F` | `#C9461D` |
| `on-accent` | `#1A0A05` | `#1A0A05` | `#FFFFFF` | `#FFFFFF` |
| `danger` | `#FF5A5A` | `#FF5A5A` | `#B3261E` | `#B3261E` |

Rules: accent is for the active tool, primary button, progress, and the ruler. Never for body text on light themes. `ink` on `bg` ≥ 14:1, `ink-muted` on `bg` ≥ 4.5:1, `on-accent` on `accent` ≥ 4.5:1 (verify in a token unit test).
**Highlight colors are content, not chrome** (the only extra hues): Yellow `#FFD60A` · Green `#6EE7A0` · Blue `#6CB6FF` · Pink `#FF8FB1`, alpha 0.35, multiply blend on light themes.
**Ruler default:** `accent` @ 16% fill + 1 px top/bottom line at 55%. Spotlight dim: `bg` @ 75%.
**Dark page treatment:** Skia color matrix (invert luminance + hue-rotate 180° so images keep hue), multiply by `#EDEAE3` to kill glare. "Original" toggle shows the untouched page.

### 3.2 Spacing
Scale only: `4 · 8 · 12 · 16 · 24 · 32 · 48`. Screen gutter 24, reader chrome gutter 16. If a value is not on the scale, it is a bug. Be generous: default to the next step up in whitespace.

### 3.3 Typography
**Inter only**, bundled (`assets/fonts`, no network). Four sizes, hierarchy through weight:

| Role | Size / weight | Use |
|---|---|---|
| Title | 28 / 600, tracking -0.02em | library hero, empty states, sheet titles |
| Heading | 20 / 600 | section heads, book title on cards |
| Body | 15 / 400–500 | labels, buttons, list rows |
| Caption | 12 / 500 | page numbers, percentages, meta (tabular figures) |

Line-height 1.4 (title 1.2). UI honors system font scale up to 1.3×; page content has its own zoom.

### 3.4 Shape, elevation, icons
- **One radius: 14.** Fully round (999) only for circular icon buttons and the ruler pill.
- No heavy shadows. Floating surfaces = `surface` + 1 px `border` + `expo-blur` backdrop (opaque on OLED). Sheets may use one soft shadow `0 8 24 rgba(0,0,0,.18)`.
- **Icons: `lucide-react-native`, stroke 1.75, size 22 (20 in dense rows).** No other icon source.
- Touch targets ≥ 48 dp; ruler buttons 56 dp.
- **One button style** (primary: accent fill + `on-accent` 15/600, height 48, radius 14; secondary: `surface` + border; text button for tertiary). **One card style** (`surface`, radius 14, 1 px border, padding 16).

### 3.5 Motion tokens
| Token | Value |
|---|---|
| `fast` | 150 ms |
| `base` | 220 ms |
| `slow` | 300 ms (max for any UI transition) |
| `ease` | `cubic-bezier(0.22, 1, 0.36, 1)` (ease-out) — no linear, no bounce, no overshoot |
| `press` | scale 0.97, 90 ms in / 150 ms out |

Haptics: **light** on taps/toggles, **selection** on ruler step and scrubber ticks (every 10 pages), **success** on milestones, **warning** on destructive actions. All user-toggleable.
Reduced motion (system "Remove animations" or in-app) → 120 ms fades; page animation = None.
All animation runs on the UI thread (Reanimated worklets / Skia shared values).

## 4. Screens

### 4.1 Library
```
│ folio                          ⌕   ⋯ │
│                                      │
│ Continue                             │
│ ┌────────┐  Designing Data-          │  Title 28
│ │ cover  │  Intensive Apps           │
│ │        │  p.124 / 612 · 20%        │  Caption 12
│ └────────┘  line 7                   │
│ [ Resume ]                           │  primary button
│                                      │
│ Shelf                      grid|list │
│ ┌────┐ ┌────┐                        │  2-col grid, 16 gap
│ │    │ │    │                        │  progress bar along cover bottom
│ └────┘ └────┘                  ( + ) │  FAB: Import
```
Skeleton cards while loading/importing. Cover → reader uses a shared-element expand (300 ms).

### 4.2 Reader (immersive)
```
(chrome hidden)                (chrome shown, blur surface)
┌──────────────────┐          ┌──────────────────┐
│                  │          │ ←  Title    ⌕ ⚑ ⋯│
│   page canvas    │          │   page canvas    │
│  ═══ruler band═══│          │  ═══ruler band═══│
│                  │          │ ──●────────────  │ scrubber + page preview
└──────────────────┘          │ ✎  ═  ◐  ☰   124 │ annotate · ruler · theme · contents · page
                              └──────────────────┘
```
Tap center toggles chrome (fade + 8 px translate, 180 ms). Auto-hide after 3 s idle when ruler/annotate inactive. Hidden-chrome status: Caption `124 / 612` at 40% opacity.

### 4.3 Ruler controls
Floating vertical pill on the right edge (drag to swap sides): `▲` / `▼` 56 dp buttons, line counter `07` Caption between, drag grip. Long-press repeats (6 steps/s) with selection haptic per step. Fades to 40% after 2 s idle; touch restores. Settings sheet: style (band / spotlight), lines (1–3), opacity, glide, haptics, "skip headers/footers".

### 4.4 Annotate mode
Bottom toolbar swaps to `highlight · underline · strike · pen · note · eraser · select`, 4 color dots, then **`undo` `redo` always visible** (disabled state when empty). Active tool: accent icon + 2 px accent underline. Tool options (pen width, opacity) in a compact popover. Two-finger tap = undo, three-finger tap = redo (hint once).

### 4.5 Contents sheet
Tabs `Contents · Bookmarks · Highlights · Pages`. Highlights row: Caption `p.124`, color chip, excerpt (Body), note (Body muted). Swipe = delete with Undo snackbar; tap = jump + pulse annotation. Header action: Export.

### 4.6 Search
Input replaces title bar; rows with Caption page number + snippet, match in accent; next/prev arrows; matches highlighted on page; skeleton rows while indexing.

### 4.7 Stats
Title-size number ("14 day streak"), weekly bars (Skia), daily goal as a thin progress bar. Milestone celebration: animated check ring (300 ms) + success haptic + toast "Goal hit".

### 4.8 Settings
Short list: Reading (animation, tap zones, keep awake, orientation) · Ruler · Theme + brightness · Storage (cache, clear) · More (advanced, about). One-line helper text under anything non-obvious.

### 4.9 First run
App opens to the library with the bundled sample ("Welcome to Folio") already present and a Resume card. Open it → 3 coachmarks (ruler ▼, long-press highlight, undo), each dismissible and shown once. No sign-in, no permissions, no tour screens.

## 5. Motion spec
| Interaction | Spec |
|---|---|
| Any press | scale 0.97 + haptic, 90 ms in, 150 ms out |
| Page curl | finger-follow 1:1, commit at 35% or fling > 800 px/s, settle 300 ms ease-out, back-face 12% darker, soft shadow on the curl line |
| Page slide | outgoing 30% parallax, incoming 100%, 250 ms ease-out |
| Page fade | 180 ms |
| Chrome show/hide | opacity + 8 px translate, 180 ms |
| Ruler step | band glides to next line 120 ms ease-out + selection haptic |
| Ruler cross-page | page turn runs; band fades in 140 ms after settle |
| Book open | cover shared-element scales to page 1, 300 ms; library fades |
| Annotation add | highlight wipes left→right 160 ms; pen is live |
| Undo / redo | annotation fades out/in 140 ms; scroll to it if off-screen |
| Sheets | slide-up 260 ms ease-out, 40% scrim |
| List entrance | stagger 40 ms, translateY 12→0, opacity 0→1 (max 8 items) |
| Optimistic writes | UI updates in the same frame; SQLite commits after; failure rolls back with message + retry |
| Celebration | check ring 300 ms + success haptic, once |

## 6. Gestures
| Context | Gesture | Action |
|---|---|---|
| Reader | tap L/R 30% | prev / next page |
| Reader | tap center | toggle chrome |
| Reader | horizontal drag | page turn (follows finger) |
| Reader | pinch / double-tap | zoom (double-tap toggles fit-width ↔ 2.5×) |
| Reader (zoomed) | drag | pan |
| Reader | long-press center | toggle ruler |
| Ruler | tap ▲/▼ | step line (hold = repeat) |
| Ruler | drag band | free move, snaps to line on release |
| Annotate | long-press text | start selection |
| Annotate | two / three-finger tap | undo / redo |
| Scrubber | drag | scrub with preview + haptic every 10 pages |
| Library | long-press card | menu: rename, reset progress, delete |

## 7. Components (build list)
`Pressable` (press + haptic, the only touch primitive), `Button`, `IconButton`, `Card`, `Sheet`, `Skeleton`, `Snackbar` (with Undo), `Toast`, `Chip`, `ProgressBar`, `EmptyState`, `ErrorState` (message + retry), `PageCanvas`, `CurlShader`, `RulerBand`, `RulerPill`, `Scrubber`, `ChromeBar`, `Toolbar`, `ColorDots`, `UndoRedoButtons`, `BookCard`, `CheckRing`. Tokens in `src/theme/tokens.ts`; all spacing/type/radius/motion imported from there only.

## 8. Icon & brand
Name **Folio**. App icon: near-black rounded square, one open-book spread in 1.5 px ink lines, a single horizontal ember line across the right page (the ruler). Wordmark: Inter 600, lowercase "folio". Splash: black, ember line draws left→right, wordmark fades in (500 ms, once).

## 9. Microcopy
Short, human, lowercase labels, no technical phrasing.
- `Saved` · `Highlight removed · Undo` · `Back at page 124` · `Book deleted · Undo`
- Empty library: `Nothing on the shelf yet.` + `Import a PDF`
- Import error: `That file didn't open. It may be damaged.` + `Try again`
- Password: `This book is locked.` · wrong password: `That's not it. Try again.`
- Ruler no-text page: `No text here. ▼ to skip.`
- Offline never appears (app is offline-first); storage low: `Phone storage is almost full.`
- Milestones: `Goal hit` · `7 days in a row` · `Finished. Nice.`

## 10. Accessibility
TalkBack labels on every control (ruler announces "line 7 of 32"); never encode meaning by color alone (highlight fill, underline rule, strike line differ in shape); 48 dp targets; haptics optional; reduce-motion honored; UI scales with font size.

## 11. Empty / loading / error matrix (design and build every cell)
| Screen | Empty | Loading | Error |
|---|---|---|---|
| Library | "Nothing on the shelf yet" + Import | skeleton cards | "Couldn't load your shelf" + Retry |
| Import | — | skeleton card with progress bar | damaged / locked / too large → message + Try again |
| Reader | — | page skeleton | render failed → Retry; file missing → Re-link or Remove |
| Contents | "No contents in this book" | skeleton rows | — |
| Highlights | "Nothing highlighted yet" + hint | skeleton rows | "Couldn't save that" + Retry (state rolled back) |
| Search | "No matches" | skeleton rows + progress | engine restarted → auto-retry, then Retry |
| Stats | "Read something to see stats" | skeleton bars | — |

## 12. Visual QA checklist (per milestone)
- [ ] Only tokens used: spacing on scale, 4 type sizes, one radius, one icon set
- [ ] One accent per theme; no stray hues outside highlight colors
- [ ] Every pressable uses `Pressable` (press scale + haptic)
- [ ] No spinners anywhere; skeletons only
- [ ] All transitions 150–300 ms ease-out; no bounce
- [ ] Every screen has empty/loading/error states per §11
- [ ] Dark, OLED, Sepia, Paper hand-checked; no pure-white glare in dark
- [ ] Ruler band aligns to baseline ± 1 px at 1×, 2.5×, 5×
- [ ] Chrome never overlaps ruler pill or annotate toolbar
- [ ] Every destructive action has Undo
- [ ] Insets/notch/gesture-nav respected
- [ ] Input response < 100 ms, 60 fps turns (dev overlay numbers recorded in `docs/QUALITY.md`)
