// ESLint flat config: Expo base + Folio's custom UI bans.
const expo = require('eslint-config-expo/flat');
const globals = require('globals');
const noBannedUi = require('./eslint-rules/no-banned-ui.cjs');

module.exports = [
  ...expo,
  {
    plugins: {
      folio: { rules: { 'no-banned-ui': noBannedUi } },
    },
    rules: {
      'folio/no-banned-ui': 'error',
      // Reanimated shared values are mutable by design (`.value =` is the
      // API). The React Compiler immutability rule cannot apply to them.
      'react-hooks/immutability': 'off',
    },
  },
  {
    // Node scripts (build tooling, spike harnesses).
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // WebView engine sources: ES2019 for the Android WebView, inlined into
    // a <script> by scripts/bundle-pdfjs.mjs. `var` and runtime-provided
    // globals (window, document, pdfjsLib) are intentional.
    files: ['src/engine/html/*.js'],
    rules: {
      'no-var': 'off',
      'no-undef': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'android/', 'ios/', '.expo/', 'dist/'],
  },
];
