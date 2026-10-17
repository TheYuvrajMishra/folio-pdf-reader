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
