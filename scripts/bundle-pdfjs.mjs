#!/usr/bin/env node
/**
 * S1 spike — bundle pdf.js for fully-offline WebView use.
 *
 * What it does:
 *  1. esbuild-bundles node_modules/pdfjs-dist/legacy/build/pdf.mjs (the main-thread
 *     build) into a single minified IIFE, global name `pdfjsLib`.
 *     (The legacy build is used deliberately: ES5-ish output, no top-level await,
 *     max compatibility with older Android System WebViews.)
 *  2. Copies node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs (already
 *     minified by the pdfjs-dist release) as the worker source. It is inlined as a
 *     string and instantiated at runtime via:
 *         const url = URL.createObjectURL(new Blob([workerSrc], {type:'text/javascript'}));
 *         pdfjsLib.GlobalWorkerOptions.workerSrc = url;
 *     pdf.js 6.x then does `new Worker(url, {type:'module'})` itself. Because the
 *     page origin is opaque (about:blank / file:), pdf.js wraps the blob URL in a
 *     `await import("<blob>")` blob wrapper first (its built-in _createCDNWrapper
 *     path) — no CDN involved at any point.
 *  3. Validates: both outputs parse as JS (node --check), and the main bundle
 *     executes in a bare vm context exposing `pdfjsLib.getDocument`.
 *  4. Writes a size/version manifest (JSON).
 *  5. Inlines both bundles into src/engine/html/bootstrap.generated.ts by replacing
 *     the __FOLIO_PDFJS_*__ placeholder constants in src/engine/html/bootstrap.ts.
 *     No CDN, no network, ever.
 *
 * Outputs:
 *  assets/pdfjs/pdf.main.bundle.js      (raw bundle, for inspection)
 *  assets/pdfjs/pdf.worker.bundle.js    (raw worker source, for inspection)
 *  assets/pdfjs/manifest.json           (versions, sizes, sha256)
 *  src/engine/html/bootstrap.generated.ts
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PDFJS = join(ROOT, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
const OUT_DIR = join(ROOT, 'assets', 'pdfjs');
const HTML_DIR = join(ROOT, 'src', 'engine', 'html');

const MAIN_SRC = join(PDFJS, 'pdf.mjs');
const WORKER_SRC = join(PDFJS, 'pdf.worker.min.mjs');
const MAIN_OUT = join(OUT_DIR, 'pdf.main.bundle.js');
const WORKER_OUT = join(OUT_DIR, 'pdf.worker.bundle.js');
const MANIFEST_OUT = join(OUT_DIR, 'manifest.json');
const BOOTSTRAP_TEMPLATE = join(HTML_DIR, 'bootstrap.ts');
const BOOTSTRAP_GENERATED = join(HTML_DIR, 'bootstrap.generated.ts');

const MAIN_PLACEHOLDER = '__FOLIO_PDFJS_MAIN_BUNDLE__';
const WORKER_PLACEHOLDER = '__FOLIO_PDFJS_WORKER_BUNDLE__';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`;
}

mkdirSync(OUT_DIR, { recursive: true });

// 1. Bundle the main-thread build -------------------------------------------------
await build({
  entryPoints: [MAIN_SRC],
  bundle: true,
  format: 'iife',
  globalName: 'pdfjsLib',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  logLevel: 'warning',
  outfile: MAIN_OUT,
});
const mainJs = readFileSync(MAIN_OUT, 'utf8');

// 2. Worker source (pre-minified by the pdfjs-dist release) ------------------------
const workerJs = readFileSync(WORKER_SRC, 'utf8');
writeFileSync(WORKER_OUT, workerJs);

// 3. Validate ----------------------------------------------------------------------
for (const [label, file] of [['main bundle', MAIN_OUT], ['worker source', WORKER_OUT]]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`ok   ${label}: parses as JS`);
  } catch (err) {
    console.error(`FAIL ${label}: does not parse`, err.stderr?.toString() ?? err.message);
    process.exit(1);
  }
}

// The IIFE must execute in a bare context and expose pdfjsLib.getDocument.
// pdf.js guards browser globals with typeof-checks, so a minimal sandbox suffices.
{
  const hostGlobals = globalThis;
  const sandbox = { console };
  // Web-platform globals a real WebView provides; Node 24 has most of them too.
  for (const name of [
    'URL', 'Blob', 'File', 'TextEncoder', 'TextDecoder', 'Uint8Array',
    'Uint8ClampedArray', 'ArrayBuffer', 'DataView', 'Promise', 'queueMicrotask',
    'fetch', 'Request', 'Response', 'Headers', 'FormData',
    'ReadableStream', 'WritableStream', 'TransformStream',
    'MessageChannel', 'MessagePort', 'EventTarget', 'Event',
    'DOMException', 'AbortController', 'AbortSignal',
    'crypto', 'performance', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'structuredClone',
  ]) {
    if (hostGlobals[name] !== undefined) sandbox[name] = hostGlobals[name];
  }
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  try {
    runInNewContext(`${mainJs}\n;globalThis.__pdfjsCheck = typeof pdfjsLib.getDocument;`, sandbox, { timeout: 15000 });
    const kind = sandbox.__pdfjsCheck;
    if (kind !== 'function') throw new Error(`pdfjsLib.getDocument is ${kind}, expected function`);
    console.log('ok   main bundle: executes in bare vm, pdfjsLib.getDocument is a function');
  } catch (err) {
    console.error('FAIL main bundle: did not execute in bare vm:', err.message);
    process.exit(1);
  }
}

// Version stamps (main build and worker must agree — pdf.js checks this at runtime).
// Match both quoted ("6.4.299") and comment/header (pdfjsVersion = 6.4.299) forms.
// Read from the SOURCES: the bundle is built verbatim from MAIN_SRC.
const versionOf = (src) => {
  const m = src.match(/pdfjsVersion\s*=\s*["']?([0-9][\w.]*)/);
  const b = src.match(/pdfjsBuild\s*=\s*["']?([0-9a-f]+)/);
  return { version: m?.[1] ?? 'unknown', build: b?.[1] ?? 'unknown' };
};
const mainVer = versionOf(readFileSync(MAIN_SRC, 'utf8'));
const workerVer = versionOf(workerJs);
if (mainVer.version !== workerVer.version || mainVer.build !== workerVer.build) {
  console.error(`FAIL version mismatch: main ${mainVer.version}/${mainVer.build} vs worker ${workerVer.version}/${workerVer.build}`);
  process.exit(1);
}
console.log(`ok   versions agree: pdfjs-dist ${mainVer.version} (build ${mainVer.build})`);

const manifest = {
  generatedAt: new Date().toISOString(),
  pdfjs: { version: mainVer.version, build: mainVer.build, source: 'pdfjs-dist/legacy/build (bundled offline, no CDN)' },
  main: { file: 'assets/pdfjs/pdf.main.bundle.js', bytes: Buffer.byteLength(mainJs), sha256: sha256(mainJs) },
  worker: { file: 'assets/pdfjs/pdf.worker.bundle.js', bytes: Buffer.byteLength(workerJs), sha256: sha256(workerJs) },
  totalBytes: Buffer.byteLength(mainJs) + Buffer.byteLength(workerJs),
};
writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
console.log(`ok   main bundle:   ${kb(manifest.main.bytes)}  sha256 ${manifest.main.sha256.slice(0, 12)}…`);
console.log(`ok   worker source: ${kb(manifest.worker.bytes)}  sha256 ${manifest.worker.sha256.slice(0, 12)}…`);
console.log(`ok   total inlined: ${kb(manifest.totalBytes)}`);

// 4. Inline into the bootstrap template ---------------------------------------------
const template = readFileSync(BOOTSTRAP_TEMPLATE, 'utf8');
for (const [label, ph] of [['main', MAIN_PLACEHOLDER], ['worker', WORKER_PLACEHOLDER]]) {
  if (!template.includes(`'${ph}'`) && !template.includes(`"${ph}"`)) {
    console.error(`FAIL bootstrap template missing placeholder '${ph}' (${label})`);
    process.exit(1);
  }
}
// IMPORTANT: use replacer *functions* — the bundles contain `$'`/`$&` sequences
// that String.replace would otherwise interpret as replacement patterns.
const generated =
  `/**\n` +
  ` * GENERATED FILE — do not edit. Produced by scripts/bundle-pdfjs.mjs\n` +
  ` * from src/engine/html/bootstrap.ts on ${manifest.generatedAt}.\n` +
  ` * pdfjs-dist ${manifest.pdfjs.version} (build ${manifest.pdfjs.build}), fully offline.\n` +
  ` */\n` +
  template
    .replace(`'${MAIN_PLACEHOLDER}'`, () => JSON.stringify(mainJs))
    .replace(`"${MAIN_PLACEHOLDER}"`, () => JSON.stringify(mainJs))
    .replace(`'${WORKER_PLACEHOLDER}'`, () => JSON.stringify(workerJs))
    .replace(`"${WORKER_PLACEHOLDER}"`, () => JSON.stringify(workerJs));
writeFileSync(BOOTSTRAP_GENERATED, generated);
console.log(`ok   wrote ${BOOTSTRAP_GENERATED} (${kb(Buffer.byteLength(generated))})`);

// 5. Round-trip check: extract the inlined strings back out of the generated
//    module and verify their sha256 matches the bundles byte-for-byte.
{
  const unquote = (name) => {
    const re = new RegExp('const ' + name + ' = ("(?:[^"\\\\]|\\\\.)*");');
    const m = generated.match(re);
    if (!m) {
      console.error(`FAIL round-trip: ${name} not found in generated module`);
      process.exit(1);
    }
    return JSON.parse(m[1]);
  };
  const mainBack = unquote('PDFJS_MAIN_BUNDLE');
  const workerBack = unquote('PDFJS_WORKER_BUNDLE');
  if (sha256(mainBack) !== manifest.main.sha256) {
    console.error('FAIL round-trip: main bundle corrupted during inline');
    process.exit(1);
  }
  if (sha256(workerBack) !== manifest.worker.sha256) {
    console.error('FAIL round-trip: worker source corrupted during inline');
    process.exit(1);
  }
  // And the bundle consts must no longer hold the placeholder values.
  if (
    generated.includes("const PDFJS_MAIN_BUNDLE = '__FOLIO_PDFJS_MAIN_BUNDLE__'") ||
    generated.includes("const PDFJS_WORKER_BUNDLE = '__FOLIO_PDFJS_WORKER_BUNDLE__'") ||
    !generated.includes('export function buildEngineHtml')
  ) {
    console.error('FAIL round-trip: generated module structure unexpected');
    process.exit(1);
  }
  console.log('ok   round-trip: inlined bundles match sha256 of the built files');
}
console.log('done.');
