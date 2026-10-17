#!/usr/bin/env node
/**
 * S1 spike — Node benchmark of pdfjs-dist (legacy build) against the fixture.
 *
 * Exercises the same two operations the headless WebView engine will perform:
 *   1. page.render() at scale 1.0 and 2.0  (raster path)
 *   2. page.getTextContent()                (line-extraction path)
 *
 * Canvas comes from @napi-rs/canvas via the canvas-factory pattern pdf.js
 * needs outside a browser (see CANVAS FACTORY below). In Node pdf.js disables
 * its worker (isNodeJS -> fake/main-thread worker), so these numbers measure
 * parse+render+extract on one thread — a pessimistic proxy for the WebView,
 * where the worker thread does the parsing.
 *
 * Metrics: render ms/page (p50/p95) at 1x and 2x, text-extraction ms/page,
 * engine init ms, peak RSS. Results -> scripts/spikes/s1/results.json + stdout.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const FIXTURE = join(ROOT, 'assets', 'test-fixtures', 'folio-test.pdf');
const RESULTS = join(__dirname, 'results.json');

// ---------------------------------------------------------------------------
// CANVAS FACTORY — the snippet pdf.js needs in Node.
//
// page.render() normally draws into a <canvas> 2d context. Outside a browser
// there is no DOM canvas, so we hand pdf.js a real raster surface from
// @napi-rs/canvas. Two supported shapes:
//
//   A) pass our own context (used below):
//        const canvas = createCanvas(w, h);
//        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
//
//   B) let pdf.js create canvases via a factory (needed for optional-content /
//      pattern canvases pdf.js allocates internally):
//        const canvasFactory = {
//          create(w, h) { const canvas = createCanvas(w, h);
//                         return { canvas, context: canvas.getContext('2d') }; },
//          reset(c, w, h) { c.canvas.width = w; c.canvas.height = h; },
//          destroy(c) { c.canvas.width = 0; c.canvas.height = 0;
//                       c.canvas = null; c.context = null; },
//        };
//        await page.render({ canvasContext, viewport, canvasFactory }).promise;
//
// We use (A) for the page surface and pass (B) as canvasFactory so internally
// allocated canvases also work.
// ---------------------------------------------------------------------------
function makeCanvasFactory() {
  return {
    create(width, height) {
      if (width <= 0 || height <= 0) throw new Error('invalid canvas size');
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext('2d') };
    },
    reset(canvasAndContext, width, height) {
      canvasAndContext.canvas.width = width;
      canvasAndContext.canvas.height = height;
    },
    destroy(canvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
      canvasAndContext.canvas = null;
      canvasAndContext.context = null;
    },
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}
function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return { n: s.length, p50: +percentile(s, 50).toFixed(2), p95: +percentile(s, 95).toFixed(2), mean: +mean.toFixed(2) };
}

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const bytes = new Uint8Array(readFileSync(FIXTURE));

let peakRss = process.memoryUsage().rss;
const rssMarks = {};
const rss = (mark) => {
  const r = process.memoryUsage().rss;
  if (mark) rssMarks[mark] = +(r / 1048576).toFixed(1);
  if (r > peakRss) peakRss = r;
};
rss('after-import');

// --- engine init: parse the document (fake worker in Node) -------------------
let t0 = process.hrtime.bigint();
const loadingTask = pdfjs.getDocument({ data: bytes });
const doc = await loadingTask.promise;
const initMs = Number(process.hrtime.bigint() - t0) / 1e6;
rss('after-open');
console.log(`document: ${doc.numPages} pages, fingerprint ${doc.fingerprint}`);

const canvasFactory = makeCanvasFactory();
const coldRender1x = [];

// Warmup: one full pass (font parse, glyph cache, canvas init).
// Timed separately as COLD first-render samples — the number that matters
// for page-turn prefetch. Steady-state numbers below exclude this pass.
for (let p = 1; p <= doc.numPages; p += 1) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const { canvas, context } = canvasFactory.create(Math.floor(viewport.width), Math.floor(viewport.height));
  t0 = process.hrtime.bigint();
  await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
  coldRender1x.push(Number(process.hrtime.bigint() - t0) / 1e6);
  await page.getTextContent();
  canvasFactory.destroy({ canvas, context });
  page.cleanup();
}
rss('after-warmup');
const render1x = [];
const render2x = [];
const textMs = [];
let totalItems = 0;
let sampleItemKeys = null;
const ITERATIONS = 3;

for (let iter = 0; iter < ITERATIONS; iter += 1) {
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);

    // text extraction
    t0 = process.hrtime.bigint();
    const tc = await page.getTextContent();
    textMs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    totalItems += tc.items.length;
    if (!sampleItemKeys && tc.items.length > 0) sampleItemKeys = Object.keys(tc.items[0]).sort();
    rss();

    // raster @1x and @2x
    for (const [scale, bucket] of [[1.0, render1x], [2.0, render2x]]) {
      const viewport = page.getViewport({ scale });
      const { canvas, context } = canvasFactory.create(
        Math.floor(viewport.width), Math.floor(viewport.height));
      t0 = process.hrtime.bigint();
      await page.render({ canvasContext: context, viewport, canvasFactory }).promise;
      bucket.push(Number(process.hrtime.bigint() - t0) / 1e6);
      // touch the pixels so the raster work can't be elided
      const png = canvas.toBuffer('image/png');
      if (png.length === 0) throw new Error('empty render');
      canvasFactory.destroy({ canvas, context });
      rss();
    }
    page.cleanup();
  }
  rss('after-iteration');
}

const results = {
  generatedAt: new Date().toISOString(),
  machine: {
    note: 'PROXY numbers: this VM (Linux x86_64), Node 24.20.0, main-thread fake worker. On-device (Android WebView, real worker thread) numbers deferred to the APK / M1.',
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpus: (await import('node:os')).cpus().length,
    totalMemMB: Math.round((await import('node:os')).totalmem() / 1048576),
  },
  pdfjs: 'pdfjs-dist 6.4.299 legacy build (pdf.mjs)',
  fixture: 'assets/test-fixtures/folio-test.pdf (10 pages, 7950 bytes)',
  engineInitMs: +initMs.toFixed(2),
  pages: doc.numPages,
  textItemsTotal: totalItems / ITERATIONS,
  textItemKeys: sampleItemKeys,
  textExtractMsPerPage: stats(textMs),
  render1xMsPerPage: stats(render1x),
  render2xMsPerPage: stats(render2x),
  coldRender1xMsPerPage: stats(coldRender1x),
  peakRssMB: +(peakRss / 1048576).toFixed(1),
  rssMarksMB: rssMarks,
};

mkdirSync(dirname(RESULTS), { recursive: true });
writeFileSync(RESULTS, JSON.stringify(results, null, 2));

const row = (k, s) => `| ${k} | ${s.p50} | ${s.p95} | ${s.mean} | ${s.n} |`;
console.log('\n## benchmark results (Node proxy)\n');
console.log(`engine init (getDocument parse): ${results.engineInitMs} ms`);
console.log(`peak RSS during render: ${results.peakRssMB} MB`);
console.log(`text items/page (avg): ${(results.textItemsTotal / results.pages).toFixed(1)}`);
console.log(`text item keys: ${results.textItemKeys.join(', ')}`);
console.log('\n| op | p50 ms | p95 ms | mean ms | n |');
console.log('|---|---|---|---|---|');
console.log(row('text extract / page', results.textExtractMsPerPage));
console.log(row('render @1x / page (warm)', results.render1xMsPerPage));
console.log(row('render @2x / page (warm)', results.render2xMsPerPage));
console.log(row('render @1x / page (COLD, prefetch case)', results.coldRender1xMsPerPage));
console.log(`\nwrote ${RESULTS}`);
console.log('rss marks (MB):', JSON.stringify(rssMarks));
await loadingTask.destroy();
