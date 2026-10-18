# DECISIONS — Folio v2 rebuild

Significant decisions and deviations, newest first. (PRD §12: decisions are
locked; this log records the *why* and the measured numbers behind them.)

## M0 (2026-10-18)

### Versioning: v2-rebuild branch, v2.0.0-m0 / v2.0.0 tags
The repo already had releases/tags v0.1.0–v1.0.2 from the previous build.
Per the rebuild brief: old tags/releases/branches are NEVER moved or
deleted, `main` is never force-pushed. All rebuild work happens on the new
branch `v2-rebuild` (root commit — clean tree, no old-build files linger).
Rebuild tags `v2.0.0-m0` (M0 CI proof) and `v2.0.0` (final) match the `v*`
workflow trigger and never collide with the old series.

### Reference board studied by name (DESIGN §2)
No images invented or copied. Borrowed ideas, by name:
- Apple Books → page-curl feel, scrubber with preview, quiet chrome
- Kindle → continue-reading hero, progress microcopy, immersive tap zones
- Moon+ Reader → ruler styles, theme depth
- KOReader → export seriousness
- Readwise Reader → highlight color UX, calm typography
- Procreate → two/three-finger undo/redo
- GoodNotes → pen/highlighter toolbar, eraser behavior
- Things 3 → sheet transitions, celebratory micro-moments
- Linear / Arc mobile → restraint, spacing rhythm, blur + border over shadow

### Spike S1 — pdf.js raster + text lines (headless WebView engine)
- **Byte transfer**: strategy (a) `file://` URI first (`allowFileAccess` +
  `allowFileAccessFromFileURLs`), fallback (b) chunked base64, 512 KiB
  chunks reassembled into a `Uint8Array` in the WebView. Never one giant
  base64 message (PRD §7.3).
- **Bundling**: pdfjs-dist **6.4.299** legacy build inlined by
  `scripts/bundle-pdfjs.mjs` into ONE `<script type="module">` (core +
  worker-Blob-URL + lines.js + bootstrap.js, single module scope). Why one
  module: the v6 builds are ESM-only (`export {…}` + `import.meta` in the
  worker); pdf.js instantiates the worker with `new Worker(url,
  {type:"module"})`, so a Blob URL works. In a `source={{html}}` WebView
  (`about:blank`) the same-origin check fails and pdf.js wraps the worker
  in `await import(blobUrl)` — still fully offline; if the worker fails at
  all, pdf.js auto-falls-back to its main-thread fake worker.
- **One clustering implementation**: `src/engine/html/lines.js` is inlined
  into the engine AND `require`d by the Node spike — measured and shipped
  code are identical.
- **Measured (Node, pdfjs-dist 6.4.299, @napi-rs/canvas, 20-page fixture):**
  - text extract + cluster: p50=**5.6 ms** p95=**41.0 ms**/page
  - raster @≤2.5x scale: p50=**23.8 ms** p95=**52.3 ms**/page
  - lines/page: min **0** (empty p.20) / max **42** / median **42**;
    margin flags **18/18** footers; rotated p.19 → **21/21** lines in order
  - empty page → 0 lines (image-only path confirmed)
- **Rotation fix found by the spike**: v6 removed
  `viewport.convertToViewportRectangle` (now `convertToViewportPoint` ×2
  corners), and clustering in rotated viewport space merged all lines of a
  90° page into one. Fix: cluster with `getViewport({rotation: 0})`, then
  rotate boxes onto the display frame (`rotateBox` in lines.js, mirrors
  `geometry.ts rotateNormRect`). Raster uses the rotated viewport, so
  overlays match the bitmap.
- **S1b — protocol integration**: the exact generated WebView module was
  driven end-to-end in Node (browser shims): open (chunked bytes) → 20
  pages + title; pageCount; getLines → 42 lines via chunked reassembly;
  renderPage → **WebP** 612×792, 86 KiB; getOutline; close. All green.
- **Double-dispatch bug found by S1b**: RN dispatched each message on both
  `document` and `window` while the engine listened on both → every request
  ran twice (two concurrent renders on one canvas). Fix: single target —
  dispatch on `window`, listen on `window` (bootstrap.js + PdfEngine.tsx).
- Verdict: **PASS** — p95 raster 52 ms is far under the 800 ms §7.7
  threshold; no fallback needed. (Device WebView numbers will differ; the
  decisive measurement is on-device in M1. The chunked, cancellable,
  ±2-prefetch design already assumes the worst case.)

### Spike S2 — Skia PageCanvas + CurlShader
- `src/render/PageCanvas.tsx` (one canvas: bitmap + overlays) and
  `src/render/CurlShader.ts` (cylinder model: fold sweeps right→left,
  back face 12% darker + light streak, soft shadow on the revealed page).
- **Measurement**: fps cannot be measured without a device/GPU on this VM.
  Code is complete and ships behind the PRD §6.3 auto-downgrade guard
  (curl→slide if frame p95 > 24 ms over 3 turns). No §7.7 fallback taken;
  decisive fps measurement is on-device in M2.

### Spike S3 — SQLite WAL + FTS5
- **Measured (node:sqlite, same SQLite engine family as expo-sqlite):**
  - insert 10,000 lines + FTS5 rows: **71 ms** total (**0.007 ms**/row)
  - FTS queries p50: `fox` 0.09 ms · `scholar AND codex` 0.10 ms ·
    phrase 0.01 ms · prefix `margin*` 0.44 ms · `NEAR` 0.02 ms
- Schema in `src/data/db.ts` mirrors the spike tables exactly
  (`page_lines`, `page_text` FTS5, full PRD §7.6 v1 schema).
- Verdict: **PASS** — FTS5 search will feel instant; no fallback needed.

### Fonts
Inter static TTFs (400/500/600) vendored into `assets/fonts/` from
`@expo-google-fonts/inter` (dev-only source) and loaded via expo-font.
No network fonts, ever (DESIGN §3.3).

### Token contrast fix (DESIGN §3.1 gate, caught by unit test)
Sepia `ink` was `#2A2218` → 12.77:1 on `#F1E7D3`, below the required 14:1.
Hand-tuned to `#211A10` (14.03:1). All four themes now pass ink ≥ 14:1,
ink-muted ≥ 4.5:1, on-accent ≥ 4.5:1 in `src/theme/__tests__/contrast.test.ts`.

### No INTERNET permission (PRD §7.10, §12)
`android.blockedPermissions: ['android.permission.INTERNET']` in
app.config.js — the pdf.js engine is fully inlined and the WebView never
loads remote content, so the release APK declares no network permission.
Verified: generated manifest carries `tools:node="remove"` on the INTERNET
entry (stripped by the manifest merger at build time).
Caveat: local debug builds (`expo run:android`) need INTERNET for Metro —
comment the line out temporarily when debugging on-device.

### Engine bundle is generated, not committed
`src/engine/html/engineHtml.ts` (~3.5 MB) is gitignored; `npm run
bundle:pdfjs` regenerates it from `node_modules/pdfjs-dist` +
`src/engine/html/{bootstrap,lines}.js`. CI runs it after `npm ci`, before
typecheck (the import in PdfEngine.tsx requires it to exist).
Rationale: the bundle is a deterministic build artifact of pinned inputs;
committing it would bloat every diff.
