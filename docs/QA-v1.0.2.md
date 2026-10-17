# QA sweep — v1.0.2

Full-app audit of `~/workspace/folio` (Expo SDK 58, TS strict). Baseline before fixes: `npx tsc --noEmit` clean, 355/355 jest tests green.

## Bug 1 — Library screen pushed to bottom half (HIGH, user-confirmed on device)
- **Where:** `src/app/index.tsx` — the only screen using the native `<SafeAreaView edges={['top','bottom']}>` from `react-native-safe-area-context`.
- **What:** On the user's phone the entire library screen (header, continue hero, shelf grid — including the full-height notebook margin rule, which is `absolute top:0 bottom:0`) starts at ~55% of the display height; the top half is empty app-bg. Pixel-verified from the user's screenshot: the margin rule is absent above y≈900/1640 and present below, proving the whole `SafeAreaView` is displaced, not its children. The reader screen (manual `useSafeAreaInsets()` padding) shows no such issue — differential evidence implicating the native `SafeAreaView` component / inset handling on this device.
- **Fix applied:** Replaced `SafeAreaView` with a plain `View` + manual `useSafeAreaInsets()` padding (the proven reader pattern). Top/bottom insets are clamped to max 96dp — defensive: a status-bar inset is never larger; this also guards against garbage inset values from the native module.
- **Needs on-device check:** verify the library now fills from the top on the reporter's phone.

## Bug 2 — Indexer overwrites good title with junk PDF metadata "(anonymous)" (MEDIUM-HIGH, user-confirmed via screenshot)
- **Where:** `src/library/indexer.ts` `runIndex` — `title: opened.title?.trim() ? opened.title.trim() : book.title`.
- **What:** Any non-empty PDF metadata title unconditionally replaced the filename-derived title. The user's resume PDF carries `(anonymous)` as its Title metadata, so the library showed "(anonymous)". Same flaw for `author`.
- **Fix applied:** New `src/library/metadata.ts` with `sanitizeMetadataTitle()` / `sanitizeMetadataAuthor()` — rejects blank/short/placeholder metadata (`anonymous`, `untitled`, `unknown`, …; parens/brackets stripped, case-insensitive) and falls back to the filename-derived title / existing author. Unit-tested in `src/library/__tests__/metadata.test.ts`.

## Bug 3 — Launch crash: worklet remote-function call (HIGH, user-confirmed)
- **Where:** `src/render/PageTurnView.tsx` `useDerivedValue` worklets calling imported `buildCurlUniforms` / `slideFrameAt` / `fadeFrameAt`.
- **Status:** Already fixed in v1.0.1 by a separate agent (`'worklet'` directives). Verified present in tree (commit `418f706`); no further action. Audit swept all other worklet contexts (`RulerOverlay`, `RulerPill`, `usePageTurn`, gesture handlers) — all use `runOnJS` correctly or call same-file functions.

## Bug 4 — `getDb()` double-open race (LOW)
- **Where:** `src/data/db.ts` — two concurrent first calls could both pass the `dbInstance` null-check and open/migrate twice.
- **Fix applied:** in-flight `dbOpening` promise guard; concurrent callers share it, failures clear it for retry.

## Bug 5 — Reader route loading/error screens ignore theme changes (LOW)
- **Where:** `src/app/reader/[id].tsx` — module-level `const theme = themes[defaultTheme]` instead of the reactive `useTheme()`.
- **Fix applied:** converted to `useTheme()` + `createStyles(t)` like the library screen.

## Notes (not fixed — dead code / observations)
- `PdfEngine.openUrl()` (file:// path) is never called and couldn't work with `allowFileAccess: false`; large files use the chunked `openStreamed` path. Left as-is (documented in code); removal is a product decision.
- `usePageTurn` `useFrameCallback` calls `runOnJS(recordFrameTime)` every frame (~60/s) — works, but wasteful; candidate for throttling later.
- `indexer.ts` comment still says "64 MiB" ceiling while `MAX_INDEX_BYTES` is 200 MiB — comment updated.

## Not verifiable without a real device (needs on-device check)
Actual taps/gestures, page-curl fps, WebView raster throughput, FTS5 latency, share-sheet/intent flow, SafeAreaView replacement rendering, theme switching visuals.
