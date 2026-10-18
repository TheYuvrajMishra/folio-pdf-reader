# DEPENDENCIES — every dependency needs a one-line justification (PRD §7.1)

No UI kits. No date/lodash libs. One icon set only.

## Runtime

| Package | Why |
|---|---|
| expo | Expo SDK 57 framework (RN 0.86, New Architecture only) |
| expo-router | File-based routing: library, reader/[id], settings (PRD §7.1) |
| react / react-native | SDK 57 pinned pair (0.86) |
| react-native-webview | Headless pdf.js engine host — rasterize + text lines (PRD §7.3) |
| @shopify/react-native-skia | Page canvas, curl/slide/fade shaders, ruler + annotation overlays (PRD §7.1) |
| react-native-reanimated | UI-thread press states, sheet/chrome/ruler motion (DESIGN §3.5) |
| react-native-gesture-handler | Tap zones, drag page-turn, sheet swipe, ruler pill drag (DESIGN §6) |
| expo-sqlite | WAL database + FTS5 search index; source of truth (PRD §7.6) |
| expo-file-system | Copy imports into app storage, read bytes for engine fallback (PRD §6.1) |
| expo-document-picker | Import PDF via SAF picker (PRD §6.1) |
| expo-sharing | Export highlights/notes via share sheet (PRD §6.10) |
| zustand | UI state only (DB is source of truth) (PRD §7.1) |
| lucide-react-native | The one icon set, stroke 1.75 (DESIGN §3.4) |
| react-native-svg | Required peer of lucide-react-native |
| expo-haptics | Tap/step/milestone haptics (DESIGN §3.5) |
| expo-keep-awake | Keep screen on while reading (PRD §5.13) |
| expo-font | Bundled Inter loading — no network fonts (DESIGN §3.3) |
| expo-status-bar | Immersive reader chrome status bar |
| expo-navigation-bar | Immersive mode / gesture-nav handling |
| expo-blur | Floating surfaces: blur + border over shadow (DESIGN §3.4) |
| @shopify/flash-list | Library grid + annotation/search lists at 60 fps (PRD §7.1) |
| expo-linking / expo-constants / react-native-safe-area-context / react-native-screens | expo-router peers |

## Build-time / dev only

| Package | Why |
|---|---|
| pdfjs-dist | Bundled offline into the WebView engine by `scripts/bundle-pdfjs.mjs` — never a CDN (PRD §7.3) |
| pdf-lib | Generates the spike test-PDF fixture (scripts/spikes/) — dev only |
| typescript | Strict typechecking (`npm run typecheck`) |
| jest / babel-jest / @types/jest | Unit tests: tokens, geometry, op-log properties |
| eslint / eslint-config-expo | Lint + the custom `folio/no-banned-ui` rule |
| @expo-google-fonts/inter | Dev-only source of the vendored Inter TTFs in `assets/fonts/` (DESIGN §3.3) |
