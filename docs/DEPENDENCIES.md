# Folio — Dependency justifications (PRD §7.1)

Every dependency needs a one-line justification. Budget is tight: no UI kits,
no icon packs (inline SVG/Skia paths), no date/lodash libs.

## Runtime

| Package | Why |
|---|---|
| `expo` ~58.0.14 | Framework: prebuild/CNG, Hermes, TS strict — the app platform. |
| `expo-router` ~58.0.23 | File-based routing: library, reader/[id], settings. |
| `react` 19.3.0 / `react-native` 0.88.0 | UI framework (Expo SDK 58 pinned pair). |
| `react-native-webview` 14.0.1 | Hosts the headless pdf.js engine (S1): rasterize + text lines, fully offline. |
| `pdfjs-dist` ^6.4.299 | The PDF engine itself — page rasterization and `getTextContent()` with per-item geometry; bundled offline via `npm run build:pdfjs`. |
| `@shopify/react-native-skia` 2.14.0 | Everything the user sees: page canvas, curl shader, ruler, annotations (S2). |
| `react-native-reanimated` 4.7.1 | UI-thread animations (page turns, ruler glide, chrome) — no JS-thread frame updates. |
| `react-native-gesture-handler` ~3.3.0 | Drag-to-turn pages, pinch/pan, ruler pill gestures. |
| `expo-sqlite` ~58.0.13 | Source of truth: books, positions, lines, FTS5 search, annotation op log (S3). |
| `expo-file-system` ~58.0.9 | App-private book storage; chunked base64 streaming of PDFs into the engine. |
| `expo-document-picker` ~58.0.4 | Import PDFs from the system picker (M1). |
| `expo-sharing` ~58.0.19 | Share sheet for highlight export / backup (P1). |
| `expo-font` ~58.0.8 | Loads bundled Instrument Serif / Inter / JetBrains Mono TTFs, offline. |
| `expo-splash-screen` ~58.0.10 | Holds the splash until fonts are ready; dark #0B0B0C background. |
| `expo-status-bar` ~58.0.3 | Light-content status bar on the dark theme. |
| `expo-navigation-bar` ~58.0.4 | Immersive reader mode + gesture-nav insets. |
| `expo-haptics` ~58.0.7 | Ruler step ticks, scrubber ticks (optional, user-toggleable). |
| `expo-keep-awake` ~58.0.3 | Keep the screen on while reading. |
| `zustand` ^5.0.15 | UI state (theme, ruler, reader chrome); SQLite stays the source of truth. |
| `expo-constants` ~58.0.12 | App metadata access (Expo standard). |
| `expo-device` ~58.0.5 | Device info for diagnostics / perf gating. |
| `expo-linking` ~58.0.13 | Deep links + "Open with" intent handling (M1). |
| `expo-image` ~58.0.15 | Cover thumbnails in the library. |
| `expo-system-ui` ~58.0.6 | Root view background config (dark). |
| `react-native-safe-area-context` ~5.10.1 | Notch / gesture-nav insets. |
| `react-native-screens` ~4.30.0 | Native screen containers for expo-router. |
| `@expo/ui` ~58.0.20 / `expo-glass-effect` ~58.0.4 / `expo-symbols` ~58.0.4 / `expo-web-browser` ~58.0.6 | Template-provided Expo modules; unused by M0 scaffold — candidates for removal in M1 cleanup. |
| `react-native-worklets` 0.13.0 | Worklets runtime required by reanimated 4.x. |
| `react-dom` 19.3.0 / `react-native-web` ~0.21.4 | Web target support (Expo template defaults; not a shipping target). |

## Dev

| Package | Why |
|---|---|
| `jest` / `ts-jest` / `@types/jest` | Unit tests (`npm test`); op-log property tests live here. |
| `typescript` ~6.0.3 | Strict TS (`npx tsc --noEmit`). |
| `esbuild` ^0.28.2 | Bundles pdf.js to the offline IIFE in `scripts/bundle-pdfjs.mjs`. |
| `pdf-lib` ^1.17.1 | Generates the synthetic test fixture PDF (`scripts/make-fixture-pdf.mjs`); P2 flatten-export candidate. |
| `better-sqlite3` ^13.0.3 | Node-side SQLite for the S3 benchmark harness (proxy numbers, not shipped). |
| `@napi-rs/canvas` ^1.0.11 | Canvas factory for running pdf.js in the S1 Node benchmark (not shipped). |
