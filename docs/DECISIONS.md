# Folio — Architecture Decision Records (M0)

Consolidates the decisions and measured numbers from the M0 spikes
(`docs/spikes/S1.md`, `S2.md`, `S3.md`). Spikes hold the detail; this file is
the short, citable version.

## S1 — Headless pdf.js engine (WebView)

- **Bundling:** esbuild-bundle `pdfjs-dist/legacy/build/pdf.mjs` to a single
  minified IIFE (`globalName: pdfjsLib`); ship
  `pdfjs-dist/legacy/build/pdf.worker.min.mjs` as the worker source string.
  Legacy build = ES5-ish, no top-level await, widest Android System WebView
  compatibility. No CDN anywhere — everything inlined.
- **Sizes (pdfjs-dist 6.4.299 / build d0991a0d5):** main bundle 528,864 bytes
  (516.5 KB); worker source 1,321,307 bytes (1290.3 KB); **total inlined
  1,850,171 bytes (~1.77 MB)**; generated HTML ~1.86 MB. Acceptable for M0: one
  HTML string built once at engine start, no network, no disk reads on the hot
  path.
- **Transfer (PRD §7.3):** (b) **chunked base64 (512 KB chunks)** into a
  preallocated `Uint8Array` inside the WebView as the primary path — works with
  every react-native-webview default left hardened, zero attack-surface change.
  (a) `file://` URL + scoped `allowFileAccess`/`allowFileAccessFromFileURLs`
  on the headless engine WebView only, for files **> 64 MB**. Never one giant
  message. Protocol: `src/engine/protocol.ts`.
- **Benchmarks (Node proxy on this VM — NOT device numbers):** engine init
  (getDocument parse) 382.8 ms; text extract/page p50 3.97 ms / p95 26.79 ms;
  render @1x warm p50 9.38 ms / p95 51.10 ms; render @1x **cold** p50 14.22 ms /
  p95 148.07 ms (the prefetch case — watch against PRD budgets); peak RSS
  314 MB (node baseline 257 MB). Corpus: `assets/test-fixtures/folio-test.pdf`
  (10 pages, 7,950 bytes, incl. empty + 90°-rotated page).
- **pdf.js 6.4.299 deviation found:** `viewport.convertToViewportRectangle()`
  no longer exists (only `convertToViewportPoint` remains). The engine
  implements the equivalent by transforming the item's four corners via
  `convertToViewportPoint` and normalizing by viewport size — verified on the
  fixture incl. the rotated page.
- **M1 follow-ups:** verify the blob worker actually spawns on-device
  (`new Worker(blobUrl, {type:'module'})` + `_createCDNWrapper` path; fake-worker
  fallback is automatic but slower); add `openFile()` streaming 512 KB chunks
  from disk via expo-file-system so large PDFs never sit whole in the RN heap;
  decide `standardFontDataUrl` (inline `standard_fonts/` vs accept fallback
  rendering) after a visual check.

## S1 — standing raster fallback (PRD §7.7)

**CONFIRMED as standing:** if WebView rasterization exceeds **800 ms/page p50
on the target device**, write a small Expo native module (Kotlin, Android
`PdfRenderer`) for rasterization and keep pdf.js for text lines only. The Node
proxy is nowhere near the threshold, but only on-device measurement counts.

## S2 — Skia page curl shader + transitions

- **Default transitions: slide/fade. Curl is EXPERIMENTAL** until on-device
  60 fps numbers exist on a mid-range Android phone (PRD §7.7).
- **Auto-downgrade rule (PRD §6.3):** if frame-time p95 > 24 ms for 3
  consecutive page turns, downgrade curl → slide and show a toast. M2 implements
  the frame-time sampler and the toast.
- If the curl shader fails to compile at runtime (`Skia.RuntimeEffect.Make`
  returns null), fall back to slide — never crash the reader on a null
  RuntimeEffect.
- **Reduced motion** (OS "Remove animations" or in-app toggle) → all
  transitions become 120 ms fades; page animation forced to None unless the
  user overrides.
- Curl spec: finger-follow 1:1; commit if progress > 35% **or** fling > 800 px/s;
  settle spring `{damping: 20, stiffness: 180, mass: 1}` ≈ 420 ms; back face
  12% darker; soft shadow along the curl line. Slide: outgoing translates 30%
  + dims 1 → 0.9, incoming translates 100%, 280 ms `cubic-bezier(0.2, 0.8, 0.2, 1)`.
  Fade: 180 ms linear cross-fade.
- **On-device validation deferred:** this VM has no Android device/emulator and
  cannot execute Skia shaders. Validation target: the v0.1.0 APK on the owner's
  phone; M2 exit criterion is 55+ fps sustained.

## S3 — SQLite + FTS5 search backend

- **FTS5** is the search backend (PRD §6.9): `page_text USING fts5(book_id
  UNINDEXED, page UNINDEXED, text)`, one row per page, `MATCH` queries, built-in
  `rank`. Compiled into the SQLite bundled with expo-sqlite (Android + iOS) —
  no extension loading, no extra dependency. `term*` covers as-you-type prefix
  search; no trigram tokenizer needed.
- **WAL journal mode** on open, so the reader reads while the background
  indexer writes without locking each other out.
- **Migrations via `PRAGMA user_version`** (`src/data/migrations.ts`,
  `src/data/schema.ts`); v1 = full PRD §7.6 schema; idempotent `IF NOT EXISTS`
  inside one transaction; `user_version` bumps only after commit.
- **All writes for one user action in one transaction** (annotation op row +
  materialized `annotations` row together — PRD §6.7).
- **Benchmarks (better-sqlite3 on this VM — proxy only, not the Hermes/ARM
  path):** insert 10,500 `page_lines` rows + 300 FTS rows in one txn:
  87.9 ms (~119k lines/s); DB size 3.61 MiB for the 300-page book; single-term
  `MATCH` p50 0.33 ms / p95 0.42 ms; phrase p50 0.13 ms / p95 0.22 ms; prefix
  `abc*` p50 0.35 ms / p95 0.52 ms; one page's 35 lines point lookup p50
  0.03 ms. As-you-type prefix queries and page-turn line lookups are an order
  of magnitude under the 50 ms ruler-step budget.
- **On-device validation deferred to the APK:** FTS5 availability in the
  expo-sqlite bundled SQLite on the target Android build, WAL throughput on
  slow eMMC, per-query latency under Hermes. Re-run the bench corpus + queries
  against the device via a dev-build script before M5 (search ships P1).

## Build-artifact hygiene (M0)

- `assets/pdfjs/*` (raw bundles + `manifest.json`) and
  `src/engine/html/bootstrap.generated.ts` (~1.8 MB) are **gitignored build
  artifacts** — never committed.
- Regenerate locally with `npm run build:pdfjs` (`node scripts/bundle-pdfjs.mjs`),
  which bundles pdfjs-dist, writes the raw bundles + manifest, and inlines them
  into `bootstrap.generated.ts`. **CI runs it after `npm ci`, before prebuild**
  (`.github/workflows/build-apk.yml`).
- `assets/test-fixtures/folio-test.pdf` (7,950 bytes) stays committed — small,
  and the spikes + tests need it.

## Prebuild signing verification (M0, 2026-10-17)

- Ran `npx expo prebuild --platform android --clean` locally (SDK 58).
- `android/app/build.gradle`: `signingConfigs { debug { storeFile
  file('debug.keystore') ... } }` and the **release build type signs with
  `signingConfigs.debug`** (`android/app/debug.keystore`, store/key pass
  `android`, alias `androiddebugkey`).
- **Outcome: the template already signs release with its bundled debug
  keystore — no Expo config plugin was needed.** The keystore ships inside the
  prebuild template, so it is stable across `--clean` regenerations (updates
  install over previous builds).
- The CI workflow's "Ensure keystore" step regenerates it with `keytool`
  (RSA 2048, validity 10000, alias `androiddebugkey`, pass `android`) only if
  a future template ever drops it. Local `keytool` verification was not
  possible (no JDK on this VM); CI has setup-java temurin 17 and runs
  `apksigner verify --print-certs` on the built APK.
- `android/` and `ios/` remain gitignored; they were removed after inspection.

## GitHub operations — `gh` CLI → Composio API deviation

The `gh` CLI is **not authenticated on this VM**. All GitHub operations
(repo creation, releases, etc.) from this project go through the **Composio
v3 `tools/execute` API** with the stored credential (see the
`custom.legacy-composio` connector: run with
`PYTHONPATH=/opt/muse/skills/custom-connector-setup/bin` and
`Content-Type: application/json` header — both are required). The CI workflow
itself uses `gh` on the GitHub runner, where `GITHUB_TOKEN` is provided —
that path is unaffected.

## DESIGN.md §2 — reference screenshots deferred

DESIGN.md asks for screenshots of Apple Books / Kindle / Moon+ / KOReader /
Readwise / Procreate / GoodNotes / Things 3 / Libby in `docs/refs/` before
building UI. **Deferred for M0** (boot + theme + fonts only). Do not invent
placeholder images — collect the real screenshots when reader UI work starts.

## Fonts

- Inter and JetBrains Mono ship as **variable TTFs** (`assets/fonts/`), covering
  the weights DESIGN.md calls for: Inter 400/500/600, JetBrains Mono 400/500.
- All fonts load via `expo-font` from the bundle — fully offline, no network.

## M0 release (2026-10-17)
- CI run 1 (tag v0.1.0 @ ecfbe50): FAILED at "Verify APK signature" — `$ANDROID_HOME/build-tools/*/apksigner` glob expanded to multiple build-tools dirs, apksigner rejected the extra path as a command. Fixed: resolve apksigner deterministically (`ls -d $ANDROID_HOME/build-tools/*/apksigner | sort -V | tail -n 1`). Pushed fix, moved tag to 278f0156.
- CI run 2 (tag v0.1.0 @ 278f0156): SUCCESS. Release "Folio v0.1.0" published with `folio-v0.1.0.apk` (78.4 MB, arm64-v8a + armeabi-v7a, debug.keystore-signed).
- Note: `gh` CLI is not authenticated on this VM; all GitHub operations went through the Composio v3 API (create repo `GITHUB_CREATE_A_REPOSITORY_FOR_THE_AUTHENTICATED_USER`, push via git-database blob/tree/commit through `github_push.py`, tag via `GITHUB_CREATE_A_REFERENCE` / delete+recreate to move it). CI status polled via the public REST API.

## M1–M6 build log (2026-10-17/18)

- **M1** — Library (SAF/document-picker import, covers, sort, dedupe),
  reader core (Skia PageCanvas, zoom 1–5x, tap zones, scrubber, immersive),
  resume at page **and line** via snippet-verified ResumeController, disk
  page cache, crash-safe engine. Committed locally per milestone.
- **M2** — Page-turn animations per the M2 agent contract:
  `src/render/PageTurnView.tsx` (Skia RuntimeEffect curl, null→slide
  fallback), `usePageTurn` (1:1 follow, 35%/800px-s commit, spring settle,
  UI-thread sampler, auto-downgrade curl→slide persisted in settings),
  `turnPolicy` pure helpers + tests. Integrated in ReaderScreen: drag turns
  own horizontal staging (pan lost its swipe staging), tap zones use
  animated turns, back-page raster preloaded for the curl's reverse face,
  downgrade surfaces a toast.
- **M3** — Reading ruler per the M3 agent contract: `useRuler` line
  stepping with cross-page turns, empty-page parking + skip, skipMargins,
  pixel-mode via engine `get-row-profile` (projection profiles, no pixels
  cross the bridge), RulerOverlay (amber band, spring glide, cross-page
  fade-in), RulerPill (draggable, 6/s long-press repeat, idle fade).
  Added `restoreToLine`/`reland` for resume. Integrated: long-press (500 ms)
  toggles, `▼` steps from pill (DESIGN §6.3), resume places the ruler at
  the saved line, reader-driven turns re-land the ruler.
- **M4** — Annotations per the M4 agent contract: SQLite `AnnotationStore`
  (op-log + materialized table in one transaction; batch ops = one undo
  step; linear history), selection snapper, Douglas-Peucker pen, Skia
  `AnnotationLayer` with distinct shapes per type, `AnnotateToolbar`.
  Integrated: toolbar swaps the scrubber, gestures swap to selection/pen/
  eraser, note modal for text, undo/redo with 140 ms fades. `select` tool
  currently offers only delete via an alert (move/recolor deferred).
- **M5** — P1 pack per the M5 agent contract: FTS5 search (escaped
  queries, ember match flash), ContentsSheet (contents·bookmarks·
  highlights·pages), Markdown/JSON export + share, sessions + streak +
  weekly stats, 4 themes + smart-invert PDF, keep-awake. Integrated as-is;
  ruler/annotate menu rows now toggle the real features.
- **M6** — Hardening: `PdfEngine.openStreamed` + chunked disk reads
  (512 KB base64 slices via expo-file-system position/length) — the file
  is never held whole in the JS heap; ceiling raised 64 MB → **200 MB**
  (PRD §6.1); engine crash auto-retry on open (max 3, backoff, PRD §7.9);
  launcher icon generated offline via `scripts/make-icons.py`
  (DESIGN §10: near-black rounded square, open-book line art, ember line);
  app version bumped to 1.0.0; README finalized.

## Deviations / deferrals recorded (M1–M6)

- **M5 agent installed no new deps** — expo-clipboard was not added
  (export uses expo-sharing only; share sheet covers copy). No new native
  modules were needed beyond the M0 set.
- **Annotation move/recolor**: select-tool currently exposes delete only
  (Alert). Full select affordances deferred.
- **Ruler styles beyond band**: spotlight / underline ruler styles and the
  pixel ruler are deferred (band only in v1.0.0).
- **Auto-pacer, brightness/warm filter, backup/restore**: deferred to a
  follow-up release (not PRD acceptance criteria).
- **Thumbnail grid view**: library is list-only in v1.0.0.
- **>200 MB files**: refused with a friendly message (documented limit).
- **On-device validation still deferred**: 60 fps curl, WebView raster/text
  throughput on ARM, expo-sqlite FTS5 latency, SkSL shader compile — all to
  be measured on Yuvraj's phone from the v1.0.0 APK.
- **Push policy change (Yuvraj, 2026-10-17)**: local commit per milestone,
  single push + tag at the end — no per-milestone tags/releases.
