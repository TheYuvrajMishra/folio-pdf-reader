# PRD — Folio (working title): PDF Book Reader

Platform: Android first (APK via GitHub Actions). iOS later.
Stack: Expo SDK 57 (React Native 0.86, New Architecture only; CNG / prebuild, **no Expo Go, no EAS**) · TypeScript strict.
Owner: Yuvraj. Doc version: 2.0 — **built and shipped as a product, not a prototype**: every shipped feature is polished, every state is designed, and the quality bar in §13 is a release gate.

---

## 1. Summary

A phone-first PDF *book* reader. Import a PDF, read it with real page-turn animations, and always resume at the exact page **and line** where you stopped. A **reading ruler** (line band) moves line by line with buttons. Full annotation toolkit (highlight, underline, pen, notes, bookmarks) where **every action is undoable/redoable at any time, even after restarting the app**.

Differentiators vs Moon+ / KOReader / Acrobat: line-accurate resume, ruler that crosses pages, persistent undo, clean highlight export, editorial dark UI.

## 2. Goals / Non-goals

**Goals**
1. Import PDF → readable in < 3 s for a typical 300-page book (first page visible; rest indexes in background).
2. Resume to page + line + ruler position, always (crash, swipe-kill, reboot).
3. 60 fps page turns on a mid-range Android (₹15–25k class).
4. Annotations never lost; undo/redo unlimited and persistent.
5. Fully offline. No account. No tracking.
6. Premium feel from the first tap: instant feedback, calm motion, designed empty/loading/error states, value visible in 30 seconds (see §13).

**Non-goals (v1)**: EPUB/MOBI, cloud sync, OCR, PDF form filling, editing PDF text, iOS release, Play Store listing, multi-user.

## 3. Users & key scenarios

Primary: student / self-learner reading long technical PDFs and books on a phone.
- "I read 40 pages last night. Open app → tap Continue → I'm on the exact line."
- "My eyes skip lines. Turn on ruler, tap ▼ to step through text."
- "I highlighted the wrong paragraph. Undo. Wait, redo."
- "Export all my highlights from this book as Markdown."

## 4. Research findings (drives decisions)

**Competitors**
- *Moon+ Reader*: 6 ruler styles, 5 auto-scroll modes (rolling blind, by pixel/line/page), day/night + 10 themes, dual-page landscape, reading stats, backup/restore, "keep eyes healthy" reminders. Weakness: annotation **export is poor** (users report unusable HTML/text export).
- *KOReader*: strongest on highlight export and customization; weak UI polish; page numbers in exports unreliable.
- *Apple Books / Kindle*: scrubber with page preview, curl/slide animation, X-ray style navigation, continue-reading hero.
→ Opportunity: Moon+-grade ruler + KOReader-grade export + Books-grade polish.

**Technical findings (critical)**
- `react-native-pdf` (+ `react-native-blob-util`) is the standard native viewer (PDFKit iOS / AndroidPdfViewer Android) and works with Expo **only via prebuild/dev build**, never Expo Go. It does **not** expose per-line text geometry, and its view can't be driven by a custom page-curl shader. Poor fit for line-level ruler + custom animations.
- Native text libs exist (`expo-pdf-text-extract`: PDFKit/PDFBox; `react-native-pdf-jsi`: search with bounding rects; `@meedwire/react-native-pdf-api`: render+extract+search) but are young/low-adoption → risk. Keep as fallbacks, not the foundation.
- **PDF.js** (`pdfjs-dist`) gives page rasterization *and* `getTextContent()` with per-item transform/width/height, plus `viewport.convertToViewportRectangle()` for PDF→screen coordinate conversion incl. rotation/crop. Mature and deterministic.
- Page curl in RN is achievable with **React Native Skia** shaders (cylinder-model curl; Expo has published a reference approach). `react-native-page-flipper` exists but is image-based and aging.

**Decision: hybrid pipeline.** PDF.js runs in a hidden WebView as a *headless engine* (rasterize pages to bitmaps + extract text lines with normalized boxes). Everything the user sees (pages, curl, ruler, annotations) is drawn natively in a **Skia canvas** from cached bitmaps. Page bitmaps + line geometry are cached on disk/SQLite.

## 5. Feature scope

### v1.0 scope — everything below ships in the same run
| # | Feature |
|---|---|
| 1 | Import PDF (file picker + "Open with" intent) → copied into app storage; password-protected PDFs supported |
| 2 | Library: grid/list, cover thumbnails, progress, "Continue reading" hero, search, sort, delete-with-undo |
| 3 | Paged reader, tap/swipe navigation, immersive mode, page scrubber, zoom/pan |
| 4 | Page animations: curl, slide, fade, none (user-selectable, finger-following) |
| 5 | Auto-save last page + line + ruler pos; resume on open |
| 6 | Reading ruler: band + spotlight styles, ▲/▼ line-step buttons, crosses page boundaries, pixel-mode fallback |
| 7 | Annotations: highlight, underline, strikethrough, pen, note, bookmark |
| 8 | Undo/redo for every annotation action, persistent across sessions |
| 9 | Themes: Dark (default), OLED, Sepia, Paper; PDF smart-invert; brightness + warm filter |
| 10 | Text search, contents (outline), bookmarks list, annotation list with jump-to |
| 11 | Export highlights/notes (Markdown/JSON via share sheet) |
| 12 | Reading stats: time, pages, streak, daily goal, milestone celebrations |
| 13 | First-run: bundled sample PDF + 3-step coachmarks; settings; keep-awake; orientation lock |
| 14 | CI: GitHub Actions builds signed release APK → Artifact + GitHub Release |

### P1 — only after v1.0.0 is released and green; never blocks it
Ruler underline style · Auto-pacer (ruler advances at set WPM) · Backup/restore (zip of DB + books) · Collections/tags · Thumbnail grid · Reading-break reminders.

### P2 — Later
Two-page landscape spread · Continuous scroll mode · Auto-crop margins · Multi-column reading order · Text-to-speech (expo-speech) · Dictionary/translate on long-press · Flatten annotations into exported PDF (pdf-lib) · Volume-key page/ruler step (native key events) · Reading-break reminders · Home-screen widget "continue reading" · Cloud sync (user-owned storage) · OCR fallback for scans · iOS build.

## 6. Detailed requirements

### 6.1 Import & library
- Sources: `expo-document-picker` (type `application/pdf`), Android intent filter (VIEW/SEND pdf), share-sheet.
- Copy into `documentDirectory/books/<bookId>.pdf` (never depend on original URI). Compute SHA-256 (first 1 MB + size) for duplicate detection.
- Background job: page count, metadata title/author, cover (page 1 @ 400 px), per-page text-line index (lazy, chunked, resumable; reader never blocks on it).
- Library: grid/list toggle, sort (recent / title / progress), progress bar per book, long-press → rename / delete / reset progress.
- Large files: support ≥ 200 MB; never load whole PDF into JS memory (see 7.3).

### 6.2 Reader
- Modes: single-page paged (P0). Fit-width default; zoom 1×–5×.
- Tap zones: left 30% prev, right 30% next, center toggles chrome. Swipe = drag the page (curl follows finger).
- Chrome (auto-hide 3 s): top bar (back, title, search*, bookmark, ⋯) and bottom scrubber with page-number ticks and thumbnail preview on scrub.
- Page indicator "p. 124 / 412 · 30%".
- Orientation: portrait default, lock option.
- Prefetch window: current ±2 pages rasterized; LRU cache cap ≈ 6 bitmaps in GPU memory.

### 6.3 Page animations
| Style | Behavior | Duration |
|---|---|---|
| Curl | Skia cylinder-curl shader, follows finger, shadow + back-face tint | 300 ms settle, ease-out, no overshoot |
| Slide | parallax slide (old page moves 30%, new 100%) | 280 ms |
| Fade | cross-fade | 180 ms |
| None | instant | 0 |
- Velocity + progress threshold decides commit vs cancel (>35% or fling >800 px/s commits).
- Honors Android "Remove animations" → forces None unless user overrides.
- Must stay ≥ 55 fps on target device; auto-downgrade curl→slide if frame time p95 > 24 ms for 3 consecutive turns (with toast).

### 6.4 Resume (last page / line)
Stored per book in `reading_position`:
```
page (1-based) · line_index · y_norm (0..1) · snippet (first 48 chars of line) ·
ruler_enabled · updated_at
```
- Save triggers: page change, ruler step (debounce 400 ms), `AppState` → background/inactive, reader unmount, low-memory event.
- On open: restore page, scroll/zoom to y_norm, place ruler on `line_index`; verify with `snippet` (if line list changed, re-find by snippet then fall back to y_norm).
- Show subtle chip "Resumed · p.124, line 7 — "the quick brown fox…"" for 2.5 s. Tap = jump to page start.
- Keep last 20 positions per book (`position_history`) → "Jump back" list (useful after accidental skips).
- If page has no text layer (scan): store y_norm only; ruler runs in pixel mode (6.5).

### 6.5 Reading ruler
Concept: a translucent band over exactly one text line (configurable 1–3 lines).
- Toggle from reader toolbar or long-press center.
- **Controls**: floating pill with `▲` (previous line) and `▼` (next line), draggable position (left/right edge, remembers). Long-press = repeat at 6 steps/s. Optional tap-hold on band to drag freely, snaps to nearest line on release.
- **Step logic**: lines come from the page's line index (sorted top→bottom; in multi-column mode column-major order — P2). `▼` on last line → turn page (using chosen animation) and place ruler on first line of next page; `▲` on first line → previous page, last line. Blank/figure-only pages: ruler hides and shows "no text — tap ▼ to skip page".
- **Auto-scroll into view** when zoomed: ruler stays at 35% from screen top (configurable) and the page pans beneath it.
- **Styles (v1.0: band + spotlight; underline is P1)**: Band (tinted), Spotlight (dim everything except ruler lines, dim 60–90%), Underline (thin accent rule).
- **Settings**: color, opacity, lines covered (1–3), band padding, dim strength, glide animation on/off, haptic tick on/off.
- **Pixel-mode fallback** for image-only pages: detect text rows via horizontal projection profile on a 25%-scale grayscale bitmap; ruler snaps to detected rows; if detection fails, fixed step = 3% page height.
- **Auto-pacer (P1)**: advance one line every `60 / (WPM / words_per_line)` s; pause on touch.
- Ruler position is part of the saved reading position (6.4).

### 6.6 Annotations
Types: **highlight** (text-snapped), **underline**, **strikethrough**, **pen** (freehand), **note** (pin + text), **bookmark** (page-level), **rect highlight** (free box; for scans).
- Text-snapped selection: drag across lines; selection expands to line-segment rects built from text-line geometry (word-level split via proportional char width). Long-press = start selection.
- Palette: 5 colors + custom; opacity slider; pen width 1–12; eraser (whole-stroke).
- Select tool: tap annotation → move (pen/note), recolor, delete, edit note.
- Annotate mode toolbar: tool wheel, color dots, **Undo** and **Redo** always visible. Procreate-style gestures in annotate mode: two-finger tap = undo, three-finger tap = redo.
- Storage format: normalized coordinates (0..1) relative to page box so annotations survive zoom/DPI/resolution changes. Rect lists for highlights, simplified polyline (Douglas-Peucker, ε=0.0005) for pen.
- Original PDF is **never modified** in v1 (non-destructive). Flatten-export is P2.

### 6.7 Undo / redo (persistent, unlimited)
Event-sourced op log, per book:
```
annotation_ops(id, book_id, seq, op_type[add|update|delete], annotation_id,
               before_json, after_json, undone INTEGER DEFAULT 0, created_at)
```
- `annotations` table is the materialized current state (fast render); updated in the same SQLite transaction as the op row.
- **Undo**: take max `seq` where `undone=0` → apply inverse (before_json) → set `undone=1`. **Redo**: min `seq` where `undone=1` → re-apply after_json → `undone=0`. New op deletes all `undone=1` rows (standard linear history).
- Multi-annotation actions (e.g., eraser sweep, "delete page annotations") are one **batch op** → single undo step.
- History survives app restart. Settings: "Clear undo history" (storage hygiene) — never automatic.
- Acceptance: any sequence of add/edit/delete/undo/redo ends in a state identical to replaying the log (property-tested).

### 6.8 Themes & display
Dark (default) · OLED black · Sepia · Paper. "Smart invert" for PDF page bitmap via Skia color matrix (invert + hue-rotate 180° so images keep hue). Brightness slider + warm filter. Respect system dark mode on first launch only.

### 6.9 Search, contents, bookmarks
Search over per-page line text (SQLite FTS5 table `page_text`); results list with snippet + page; highlight matches on page. Outline from PDF.js `getOutline()`. Bookmarks list + annotation list tabs.

### 6.10 Export (v1.0) & backup (P1)
Export highlights/notes per book → Markdown (grouped by page, with page numbers, color tag, note text), JSON, share sheet. Backup = single `.zip` (SQLite db + books + covers) via share sheet; restore from picker.

### 6.11 Stats
Reading sessions (start/end, pages, active seconds — pause when app backgrounded or no touch 60 s). Daily goal (pages or minutes), streak, weekly bar chart (Skia). Milestones (goal hit, 3/7/30-day streak, book finished) trigger one small celebration: success haptic + animated check + one-line toast. Never confetti spam.

## 7. Architecture

### 7.1 Stack
| Concern | Choice |
|---|---|
| Framework | Expo SDK 57 (RN 0.86, New Architecture only), prebuild/CNG, TS strict, Hermes |
| Routing | expo-router |
| Canvas / animation | `@shopify/react-native-skia`, `react-native-reanimated`, `react-native-gesture-handler` (versions via `npx expo install`) |
| PDF engine | `react-native-webview` hosting bundled **pdfjs-dist** (legacy build, inlined, offline) |
| DB | `expo-sqlite` (WAL, FTS5) |
| Files | `expo-file-system` (+ `expo-document-picker`, `expo-sharing`) |
| State | **zustand** (UI) + SQLite as source of truth |
| Icons | `lucide-react-native` + `react-native-svg` — one set, one stroke weight (1.75), nothing mixed |
| Misc | `expo-haptics`, `expo-keep-awake`, `expo-font`, `expo-status-bar`, `expo-navigation-bar`, `expo-blur`, `@shopify/flash-list` |

**Dependency budget:** keep it tight (no UI kits, no date/lodash libs; one icon set only). Every new dependency needs a one-line justification in `docs/DEPENDENCIES.md`.

### 7.2 Module layout
```
app/                      expo-router screens: (library), reader/[id], settings
src/
  engine/                 pdf.js bridge (WebView host, protocol, job queue)
    html/                 inlined pdf.js bootstrap
    protocol.ts           typed messages: open, renderPage, getLines, getOutline, close
  render/                 Skia: PageCanvas, CurlShader, SlideFx, FadeFx, color-matrix themes
  reader/                 ReaderScreen, gestures, chrome, scrubber, zoom/pan controller
  ruler/                  RulerOverlay, ruler store, line navigator, pixel-mode detector
  annotations/            tools, selection snapper, ops (undo/redo), renderers
  data/                   db.ts, migrations, repositories (books, positions, annotations, ops)
  library/                import pipeline, covers, grid
  theme/                  tokens, fonts
  util/                   geometry (norm coords), debounce, lru
docs/                     PRD.md, DESIGN.md, DEPENDENCIES.md, DECISIONS.md, QUALITY.md
.github/workflows/build-apk.yml
```

### 7.3 Rendering pipeline
```
RN (JS)  ──postMessage──▶  WebView (pdf.js, headless)
   ▲                           │ page.render → canvas → JPEG/WebP bytes
   │◀── base64 chunks ─────────┘ getTextContent → lines[] (normalized)
   ▼
Disk cache: pages/<bookId>/<page>@<scale>.webp   SQLite: page_lines
   ▼
Skia <Image> in PageCanvas  + overlays (ruler, annotations) in one Canvas
```
- **Getting PDF bytes into WebView** (Spike S1 decides): (a) Android `allowFileAccess` + `allowFileAccessFromFileURLs` and let pdf.js read `file://` URL; else (b) chunked base64 transfer (512 KB chunks) into a `Uint8Array` inside the WebView; else (c) native fallback (see 7.7). Never base64 the whole file in one message.
- Raster scale: `min(2.5, screenWidthPx / pageWidthPt)`; render at 1× then upgrade to 2× when zoomed (tile-free v1; tiles = P2).
- Output format WebP q≈85 (JPEG fallback). Cache key includes scale + theme-independent (theme applied in Skia).
- Prefetch ±2 pages; cancel stale render tasks (`renderTask.cancel()`) on fast scrubbing.
- Memory cap: ≤ 6 decoded `SkImage`; evict LRU; dispose properly.

### 7.4 Text-line extraction
For each page: `getTextContent()` → items `{str, transform[a..f], width, height, hasEOL}`.
1. Convert each item rect with `viewport.convertToViewportRectangle([x, y, x+w, y+h])` (handles rotation/crop), normalize by viewport size → `{x0,y0,x1,y1}` in 0..1.
2. Sort by `y0` then `x0`. Cluster into lines when vertical overlap > 50% of the smaller height (tolerance ≈ 0.5 × median item height).
3. Within a line, order by `x0`; merge into `Line{ idx, text, box, words[] }` (words via proportional split of `str` by char count × width).
4. Drop empty/whitespace lines, tiny artifacts (height < 0.4 × median), page numbers/headers are **kept** (user may want them) but flagged `kind: 'margin'` when in top/bottom 6% — ruler can optionally skip them.
5. v1 assumes single reading column; P2 adds column detection by x-gap histogram.
6. Persist to `page_lines(book_id, page, idx, x0,y0,x1,y1, text)`; also feeds FTS.

### 7.5 Coordinate system
All overlays/annotations use **normalized page coords (0..1, top-left origin)**. Transform to screen = `norm × pageRectOnScreen` (includes zoom/pan). One `geometry.ts` owns conversions; unit-tested incl. rotated pages (90/180/270) and CropBox ≠ MediaBox.

### 7.6 Data model (SQLite)
```sql
books(id TEXT PK, title, author, file_path, size_bytes, page_count, cover_path,
      hash, added_at, last_opened_at, indexed_pages INTEGER DEFAULT 0, deleted_at);
reading_position(book_id PK, page, line_index, y_norm REAL, snippet, ruler_enabled INTEGER, updated_at);
position_history(id INTEGER PK, book_id, page, line_index, y_norm, snippet, at);
page_lines(book_id, page, idx, x0, y0, x1, y1, text, kind, PRIMARY KEY(book_id,page,idx));
page_text USING fts5(book_id UNINDEXED, page UNINDEXED, text);
annotations(id TEXT PK, book_id, page, type, color, opacity, data_json, note, created_at, updated_at, deleted INTEGER DEFAULT 0);
annotation_ops(id INTEGER PK, book_id, seq, op_type, annotation_id, before_json, after_json, undone INTEGER DEFAULT 0, created_at);
bookmarks(id, book_id, page, label, created_at);
sessions(id, book_id, started_at, ended_at, pages_read, active_seconds);
settings(key PK, value_json);
```
Migrations versioned via `PRAGMA user_version`. WAL on. All writes for one user action in one transaction.

### 7.7 Fallbacks (if spikes fail)
- If WebView rasterization too slow (> 800 ms/page p50 on target): write a small **Expo native module (Kotlin, Android `PdfRenderer`)** for rasterization; keep pdf.js only for text lines.
- If WebView text extraction unreliable: evaluate `react-native-pdf-jsi` (search rects) or PDFBox-based extraction as line source.
- If Skia curl janks: ship slide/fade as default, curl as "experimental".

### 7.8 Performance budgets (mid-range Android)
Cold start → library < 1.5 s · open book → first page < 700 ms (cached) / < 1.8 s (first time) · page turn 55–60 fps · cached page ready < 120 ms · ruler step latency < 50 ms · annotation draw latency < 1 frame · memory < 350 MB steady state.

### 7.9 Error handling
Corrupt/unsupported PDF → friendly error + delete option. Password PDF → password sheet (wrong password = inline error; password never stored). Engine crash (WebView killed) → auto-restart engine, re-open doc, retry queue (max 3). DB failure → toast + log; never silently drop an annotation op.

### 7.10 Privacy / permissions
No network permission at runtime needed (declare none beyond defaults). Storage via app-private directory + SAF picker (no broad storage permission). No analytics.

## 8. Build & release (no EAS)
- CNG: `android/` and `ios/` are **gitignored**; CI runs `expo prebuild --platform android --clean`.
- GitHub Actions `.github/workflows/build-apk.yml`: ubuntu-latest, Node 22, JDK 17, `npm ci` → `expo prebuild` → `./gradlew assembleRelease` → sign with debug/generated keystore → upload as workflow artifact **and** GitHub Release asset.
- Triggers: tag `v*` and `workflow_dispatch`.
- Signing: use the keystore shipped by the Expo prebuild template (stable across builds → updates install over previous). Generate with `keytool` only if missing. Verify with `apksigner verify`.
- ABIs: arm64-v8a + armeabi-v7a (smaller, faster build).
- Local dev: `npx expo run:android` (needs Android SDK) or install CI APKs.

## 9. Milestones
| M | Scope | Exit criteria |
|---|---|---|
| M0 | Repo, CI pipeline, hello-world APK released; **Spikes** S1 (WebView pdf.js raster+lines), S2 (Skia page + curl shader), S3 (SQLite + FTS5) | APK on Release page; spike numbers recorded in `docs/DECISIONS.md` |
| M1 | Library, import, basic reader, scrubber, zoom, **resume page+line** | kill app → reopen at same line |
| M2 | Page animations (curl/slide/fade), gesture-following, auto-downgrade | 55+ fps on test device |
| M3 | Ruler (band), ▲/▼, cross-page, pixel-mode fallback, persistence | step through 50 pages without gaps |
| M4 | Annotations + persistent undo/redo | op-log property tests green |
| M5 | Search, contents, bookmarks, annotation list, export, stats + celebrations, themes polish, first-run + sample PDF | all §10 criteria 1–8 pass |
| M6 | Premium polish pass (§13 gate), hardening: large-file tests, a11y, crash recovery, README | release v1.0.0 |

Milestones are an internal order, **not stopping points**: the whole plan runs in one continuous pass. Release tags: `v0.1.0` after M0 (proves CI) and `v1.0.0` at the end.

## 10. Acceptance criteria (v1.0)
1. Import a 500-page, 80 MB PDF; library shows cover + page count; reading starts before indexing completes.
2. Read to p.124, ruler on line 7, force-stop app, reopen → same page, same line, ruler on, within 1 line.
3. Curl turn works with finger-follow; cancel by dragging back; no visual tearing.
4. ▼ on last line of p.10 → p.11 first line; ▲ on first line of p.11 → p.10 last line.
5. 30 highlight/pen/erase actions, then 30 undos → clean page; 30 redos → identical to before; survives app restart between steps.
6. Image-only PDF: ruler works in pixel mode.
7. APK from GitHub Release installs on a clean device and passes 1–6.
8. Airplane mode: everything works.
9. First-run on a clean install: sample PDF present; user completes read → ruler → highlight → undo in under 30 s.
10. Every row of §13 passes and is recorded in `docs/QUALITY.md`.

## 11. Risks
| Risk | Mitigation |
|---|---|
| WebView pdf.js slow / memory heavy on big PDFs | S1 spike; page cache; native PdfRenderer fallback (7.7) |
| PDF text order/lines messy (columns, tables, math) | Heuristics + manual ruler drag; P2 column detection; pixel-mode fallback |
| Skia curl perf on low-end | Auto-downgrade; curl optional |
| Debug-signed APK can't be on Play Store | Fine for v1 (sideload); add real keystore secret before any store release |
| New Architecture / lib version drift | Pin via `npx expo install`; lockfile committed; one upgrade per milestone |
| Annotation drift between renders | Normalized coords + geometry tests incl. rotation/CropBox |

## 12. Decisions locked (do not ask, do not revisit)
- App name **Folio**. Package id `com.yuvrajmishra.folio`. Repo `folio-pdf-reader`, public.
- Min Android 8.0 (API 26) unless the Expo SDK requires higher. Portrait primary, landscape supported.
- Spike failures auto-select the §7.7 fallback; record in `docs/DECISIONS.md`, keep going.
- No paywall, ads, accounts, analytics, or network permission.

## 13. Premium quality bar (release gate for v1.0.0)
Each line is testable; the agent verifies and records pass/fail in `docs/QUALITY.md`.

| Area | Requirement |
|---|---|
| Visual restraint | One accent (ember) + 2–3 neutrals per theme; spacing only from scale `4/8/12/16/24/32/48`; one typeface family (Inter), 4 sizes; one icon set; one radius; no heavy gradients/shadows. Highlight colors are content, not UI chrome. |
| Tap feedback | Every pressable has a press state (scale 0.97, 90 ms) and the right haptic (light = tap/toggle, selection = ruler step/scrub tick, success = milestone). Shared `Pressable` primitive; raw `TouchableOpacity` banned by lint rule. |
| Motion | UI transitions 150–300 ms, ease-out `cubic-bezier(0.22, 1, 0.36, 1)`; no linear motion, no bounce/overshoot; cover → reader shared-element (continuity) transition; reduce-motion honored. |
| Loading | Skeletons (library cards, reader page, sheets). **Zero spinners.** |
| Performance | Input → visible response < 100 ms everywhere; 60 fps scrolling/turns; optimistic UI for every write (annotation, bookmark, delete) with SQLite sync after. |
| Resilience | Every error has a human message + retry/remedy; no raw error strings, no red-screen/blank states; error boundary at root and reader; file-missing and low-storage handled. |
| States | Each screen has designed empty, loading, error, and populated states (matrix in DESIGN.md §11). |
| Dark mode | Dark is the baseline (not inverted light); OLED, Sepia, Paper each hand-tuned; no pure-white glare. |
| Copy | Short, human, calm ("Saved", "Highlight removed · Undo"); no "operation completed successfully" phrasing; lowercase labels per DESIGN.md. |
| First run | Sample book auto-added; open → read → ruler → highlight → undo achievable in < 30 s with zero permissions or sign-in. |
| Delight | Milestone moments (goal, streak, finish) — small, once, skippable. |
| Restraint | Settings stay short; advanced options hidden behind one "more" row; every shipped feature feels excellent or is cut. |
