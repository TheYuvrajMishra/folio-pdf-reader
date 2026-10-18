#!/usr/bin/env node
/**
 * Spike S1b — engine protocol integration test.
 * Runs the EXACT generated WebView module (core + worker-blob + lines.js +
 * bootstrap.js) in Node with minimal browser shims, then drives the full
 * RN↔WebView protocol: open (chunked bytes) → pageCount → getLines →
 * renderPage → getOutline → close. Validates the code that ships in the
 * WebView, including chunked reassembly on both directions.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));

// ---- browser shims (before importing the engine module) ----
const { createCanvas } = require('@napi-rs/canvas');
const listeners = [];
const posted = []; // WebView → RN messages
globalThis.window = globalThis;
// pdf.js render uses rAF in its paint loop; setTimeout is fine for the harness.
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// Node's ESM loader can't import blob: URLs (pdf.js's Node fake-worker path
// does `await import(workerSrc)`). In the real WebView (Chrome) blob: module
// workers work fine. Harness-only shim: return a data: URL (importable in
// Node) for the worker blob the engine module creates.
const workerSrcText = fs.readFileSync(
  require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'), 'utf8');
const workerDataUrl =
  'data:text/javascript;base64,' + Buffer.from(workerSrcText, 'utf8').toString('base64');
URL.createObjectURL = () => workerDataUrl;
globalThis.ReactNativeWebView = {
  postMessage: (s) => posted.push(JSON.parse(s)),
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? createCanvas(2, 2) : {}),
  addEventListener: (_t, fn) => listeners.push(fn),
};
globalThis.addEventListener = (_t, fn) => listeners.push(fn);

function dispatchToEngine(obj) {
  const data = JSON.stringify(obj);
  for (const fn of listeners) fn({ data });
}
function take(pred, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const i = posted.findIndex(pred);
      if (i >= 0) return resolve(posted.splice(i, 1)[0]);
      if (Date.now() - t0 > timeoutMs) return reject(new Error('timeout waiting for engine message'));
      setTimeout(poll, 10);
    })();
  });
}
/** Collect chunked responses the way PdfEngine does; surface failures. */
async function takeChunked(chunkType) {
  const plainType = chunkType.replace(/Chunk$/, '');
  const chunks = new Map();
  let total = -1;
  for (;;) {
    const m = await take((x) => x.type === chunkType || x.type === plainType);
    if (m.ok === false) throw new Error(`engine failed: ${m.message}`);
    chunks.set(m.chunkIndex, m.chunk);
    total = m.totalChunks;
    if (chunks.size === total) {
      const parts = [];
      for (let i = 0; i < total; i++) parts.push(chunks.get(i));
      return JSON.parse(parts.join(''));
    }
  }
}

const pdfBytes = fs.readFileSync(path.join(root, 'fixtures', 'test-book.pdf'));
const b64 = pdfBytes.toString('base64');
const CHUNK = 512 * 1024;

// Import the generated engine module (runs the IIFE, posts 'ready').
await import(path.join(root, 'fixtures', 'engine-module.mjs'));

async function main() {
  await take((m) => m.type === 'ready');
  console.log('engine ready');

  // open (bytes path)
  const totalChunks = Math.max(1, Math.ceil(b64.length / CHUNK));
  dispatchToEngine({ id: 'o0', type: 'open', source: { kind: 'bytes', totalChunks } });
  await take((m) => m.type === 'openAck');
  for (let i = 0; i < totalChunks; i++) {
    dispatchToEngine({
      id: i === totalChunks - 1 ? 'o1' : `oc${i}`,
      type: 'openChunk',
      chunkIndex: i,
      totalChunks,
      base64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
    });
  }
  const opened = await take((m) => m.type === 'openResult');
  console.log('open:', opened.ok, 'pages:', opened.pageCount, '| title:', opened.title);
  if (!opened.ok || opened.pageCount !== 20) throw new Error('open failed');

  dispatchToEngine({ id: 'c0', type: 'getPageCount' });
  const pc = await take((m) => m.type === 'pageCountResult');
  console.log('pageCount:', pc.pageCount);

  dispatchToEngine({ id: 'l1', type: 'getLines', page: 1 });
  const linesRes = await takeChunked('linesResultChunk');
  console.log('lines p1:', linesRes.lines.length, '| first:', JSON.stringify(linesRes.lines[0].text.slice(0, 40)));

  dispatchToEngine({ id: 'r1', type: 'renderPage', page: 1, scale: 1 });
  const renderRes = await takeChunked('renderResultChunk');
  console.log('render p1:', renderRes.render.format, renderRes.render.width + 'x' + renderRes.render.height,
    (renderRes.render.dataBase64.length / 1024).toFixed(0) + ' KiB b64');
  if (!renderRes.render.dataBase64.length) throw new Error('empty render');

  dispatchToEngine({ id: 'g0', type: 'getOutline' });
  const outline = await take((m) => m.type === 'outlineResult');
  console.log('outline nodes:', outline.outline.length);

  dispatchToEngine({ id: 'x0', type: 'close' });
  await take((m) => m.type === 'closed');
  console.log('S1b PROTOCOL OK — open/chunks/lines/render/outline/close all green');
}

main().catch((e) => {
  console.error('S1b FAILED:', e.message);
  process.exit(1);
});
