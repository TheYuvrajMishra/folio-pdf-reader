# Folio — PDF book reader (Android)

Folio is a phone-first PDF *book* reader: import a PDF, read with real
page-turn animations, resume at the exact page **and line**, step through
text with a reading ruler, annotate everything with persistent undo/redo,
and export highlights as Markdown. Fully offline. No account. No tracking.

## Install the APK

1. Open the [latest release](https://github.com/TheYuvrajMishra/folio-pdf-reader/releases/latest).
2. Download `folio-v2.0.0-m0.apk` (or newer) and open it on your Android phone.
3. Allow "install unknown apps" when prompted. Updates install over previous
   builds (stable debug-keystore signing).

Works in airplane mode. No permissions requested.

## Dev setup

Prerequisites: Node 22+, JDK 17 (only for the native build).

```sh
npm ci
npm run bundle:pdfjs   # inline pdfjs-dist into the offline WebView engine
npm run typecheck && npm run lint && npm test
npx expo run:android    # local dev build (needs Android SDK)
```

The pdf.js engine bundle (`src/engine/html/engineHtml.ts`) is generated —
never edit it; edit `src/engine/html/bootstrap.js` and re-run
`npm run bundle:pdfjs`.

## Scripts

| Script | What |
|---|---|
| `npm start` | Expo dev server |
| `npm run bundle:pdfjs` | Build the offline pdf.js engine bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint incl. the `folio/no-banned-ui` rule |
| `npm test` | Jest unit tests (tokens, geometry) |

## Architecture (PRD §7)

```
RN (JS) ──postMessage──▶ WebView (pdf.js, headless, bundled offline)
   ▲                         │ page.render → canvas → WebP bytes (chunked)
   │◀── chunked JSON ────────┘ getTextContent → lines[] (normalized 0..1)
   ▼
Disk cache: pages/<bookId>/<page>@<scale>.webp   SQLite: page_lines + FTS5 page_text
   ▼
Skia PageCanvas: page bitmap + ruler + annotations in one canvas
```

- **Engine** (`src/engine/`): typed protocol (`protocol.ts`), WebView host
  with job queue + chunked byte transfer + auto-restart (`PdfEngine.ts`),
  pdf.js bootstrap (`html/bootstrap.js`, inlined by `scripts/bundle-pdfjs.mjs`).
- **Render** (`src/render/`): Skia `PageCanvas`, cylinder-curl shader.
- **Data** (`src/data/`): expo-sqlite WAL, versioned migrations, FTS5.
- **UI** (`src/ui/`): one `Pressable` primitive, `Skeleton` (no spinners),
  `Sheet`, `Snackbar` (Undo), `Toast`, `EmptyState`/`ErrorState`.
- **Theme** (`src/theme/`): all tokens in `tokens.ts`; Dark/OLED/Sepia/Paper.

See `docs/DECISIONS.md` for spike measurements and decision log,
`docs/DEPENDENCIES.md` for dependency justifications.

## Release process

Pushing a `v*` tag (or manual *Run workflow*) builds a signed release APK
in GitHub Actions (`.github/workflows/build-apk.yml`): typecheck → lint →
tests → `expo prebuild` → `assembleRelease` (arm64-v8a + armeabi-v7a) →
artifact + GitHub Release. `versionCode` = run number, `versionName` = tag.
