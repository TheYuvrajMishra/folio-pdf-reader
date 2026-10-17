# Folio (working title)

A phone-first PDF *book* reader for Android: import a PDF, read with real
page-turn animations, and always resume at the exact page **and line** where
you stopped. Differentiators vs Moon+ / KOReader / Acrobat: line-accurate
resume, a ruler that crosses pages, persistent unlimited undo, clean highlight
export, editorial dark UI.

Platform: Android first (APK via GitHub Actions). iOS later.
Stack: Expo (CNG / prebuild, **no Expo Go, no EAS**) · React Native · TypeScript
strict · Hermes. Full PRD: [`PRD.md`](PRD.md). Design spec: [`DESIGN.md`](DESIGN.md).

## Setup

Requirements: Node 20, JDK 17 (for the release build only), Android SDK
(for local `run:android` only).

```bash
npm ci
npm run build:pdfjs   # generate the offline pdf.js engine artifacts (gitignored)
npm test              # 355 tests green
npx tsc --noEmit      # clean
npx expo prebuild --platform android --clean   # regenerates android/ (gitignored)
```

## Scripts

| Script | What |
|---|---|
| `npm test` | jest (ts-jest): 355 unit/property tests, all green. |
| `npm run build:pdfjs` | `node scripts/bundle-pdfjs.mjs` — bundles pdfjs-dist offline, writes `assets/pdfjs/*` + `src/engine/html/bootstrap.generated.ts` (both gitignored; CI runs this before prebuild). |
| `npm run make-icons` | `python3 scripts/make-icons.py` — regenerates launcher icons (DESIGN §10). |
| `npm start` | Expo dev server. |
| `npx expo prebuild --platform android --clean` | Generate `android/` from the Expo config (gitignored; CI does this). |
| `npx tsc --noEmit` | Strict typecheck. |
| `npx expo-doctor` | Expo dependency health check. |

## Architecture (PRD §7.2 / §7.3)

```
src/app/                  expo-router screens (expo-router natively prefers src/app/):
                        library (index), reader/[id], settings
src/
  engine/                 pdf.js bridge (WebView host, protocol, job queue)
    html/                 inlined pdf.js bootstrap (bootstrap.ts template +
                          bootstrap.generated.ts, the latter gitignored)
  render/                 Skia: PageCanvas, curl shader, slide/fade specs
  reader/                 ReaderScreen, gestures, chrome, scrubber, zoom/pan
  ruler/                  RulerOverlay, ruler store, line navigator, pixel-mode
  annotations/            tools, selection snapper, ops (undo/redo), renderers
  data/                   db.ts, migrations, repositories (books, positions, annotations, ops)
  library/                import pipeline, covers, grid (M1)
  theme/                  tokens (DESIGN.md §3–§5), fonts (expo-font, offline)
  util/                   geometry (normalized coords), debounce, lru
docs/                     PRD.md, DESIGN.md, DEPENDENCIES.md, DECISIONS.md, spikes/
.github/workflows/build-apk.yml   signed release APK → artifact + GitHub Release
```

**Rendering pipeline:** RN (JS) —postMessage→ headless WebView running pdf.js
(page.render → canvas → JPEG/WebP bytes; getTextContent → normalized line
boxes) —chunked base64 (512 KB)→ disk cache + SQLite `page_lines` → Skia
`<Image>` in `PageCanvas` + overlays (ruler, annotations) in one Canvas.
All overlays use normalized page coords (0..1, top-left origin).

## Spike summary (M0 — numbers)

| Spike | Result |
|---|---|
| **S1** headless pdf.js in WebView | Offline IIFE + blob worker, total inlined **~1.77 MB** (pdfjs-dist 6.4.299). Transfer: chunked base64 (512 KB) primary; M6 raised the ceiling to **200 MB** with streamed disk reads (never whole-file in JS heap); `file://` open-url path kept as code for a future native fallback. Node-proxy bench: text extract p50 3.97 ms, render @1x cold p50 14.22 ms / p95 148.07 ms. |
| **S2** Skia page curl | Cylinder-model SkSL shader + specs; **slide/fade default, curl experimental** until 60 fps is measured on-device. Auto-downgrade: curl → slide if frame p95 > 24 ms for 3 consecutive turns. |
| **S3** SQLite + FTS5 | FTS5 (bundled with expo-sqlite) + WAL + `user_version` migrations. Proxy bench (300-page book): index 10,500 lines in 87.9 ms; `MATCH` p50 0.33 ms; DB 3.61 MiB. |

Decisions and follow-ups: [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Installing the APK

1. Go to the repo's **Releases** page (or the `folio-apk` artifact on any
   workflow run).
2. Download `folio-v*.apk` (e.g. `folio-v0.1.0.apk`).
3. Install on your Android phone (allow "install unknown apps" when prompted).
   The APK is signed with the Expo template's stable debug keystore, so
   updates install over previous builds.

## Project status — v1.0.0 (M0→M6 complete)

- **M0** — scaffold, CI, spikes S1/S2/S3, hello-world APK.
- **M1** — library (import via SAF/document-picker, covers, sort), reader
  (Skia PageCanvas, zoom 1–5x, tap zones, scrubber, immersive), resume at
  page **and line** (snippet-verified), disk page cache, crash-safe engine.
- **M2** — page-turn animations: Skia curl (experimental), slide/fade;
  1:1 finger-follow drag, auto-downgrade curl→slide on slow frames.
- **M3** — reading ruler: line stepping across pages, pixel-mode
  (projection-profile row detection), empty-page skip, long-press toggle,
  resume placement.
- **M4** — annotations: highlight/underline/strike/pen/note/eraser/select,
  SQLite op-log with **persistent unlimited undo/redo**, export-ready.
- **M5** — P1 pack: FTS5 search, contents/bookmarks/highlights sheets,
  Markdown/JSON export, reading stats + streaks, 4 themes + smart-invert,
  keep-awake.
- **M6** — hardening: 200 MB streamed opens, engine crash auto-retry,
  launcher icon (DESIGN §10), a11y labels pass.

On-device validation (60 fps curl, WebView raster/text on ARM,
expo-sqlite, shader compile) is deferred to the release APK on Yuvraj's
phone — see [`docs/DECISIONS.md`](docs/DECISIONS.md).
