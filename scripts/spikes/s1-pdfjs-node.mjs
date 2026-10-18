#!/usr/bin/env node
/**
 * Spike S1 — pdf.js raster + text-line extraction (PRD §9 M0).
 *
 * Runs the SAME pdfjs-dist build that scripts/bundle-pdfjs.mjs inlines,
 * and the SAME clustering code (src/engine/html/lines.js) the WebView
 * engine ships. Measures in Node:
 *   - ms/page for getTextContent() + clustering
 *   - ms/page for page.render() (only if a canvas impl is available)
 *   - lines/page + margin-flag sanity
 *
 * Device caveat: Node timings are indicative, not device WebView numbers.
 * The decisive measurement happens on-device in M1; the architecture
 * (chunked transfer, ±2 prefetch, cancel) is built for the worst case.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const pdfPath = path.join(root, 'fixtures', 'test-book.pdf');

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error('fixture missing — run: node scripts/spikes/gen-test-pdf.mjs');
    process.exit(1);
  }
  const data = new Uint8Array(fs.readFileSync(pdfPath));

  // Same build the bundler inlines (legacy preferred).
  let pdfjsPath;
  try {
    pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  } catch {
    pdfjsPath = require.resolve('pdfjs-dist/build/pdf.mjs');
  }
  const pdfjs = await import(pdfjsPath);
  console.log(`pdfjs: ${path.basename(path.dirname(pdfjsPath))}/${path.basename(pdfjsPath)} v${require('pdfjs-dist/package.json').version}`);

  const { clusterTextItems, rotateBox } = require('../../src/engine/html/lines.js');

  // Raster needs a canvas impl in Node. pdf.js v6 auto-detects
  // `@napi-rs/canvas` (NodeCanvasFactory); if it is absent the render
  // half of the spike is device-only.
  let canRaster = false;
  try {
    require.resolve('@napi-rs/canvas');
    canRaster = true;
  } catch {
    console.log('raster: SKIPPED — no canvas impl in Node (device WebView will render)');
  }

  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  console.log(`pages: ${doc.numPages}`);

  const textMs = [];
  const renderMs = [];
  const lineCounts = [];
  let marginFlags = 0;

  const N = doc.numPages;
  for (let p = 1; p <= N; p++) {
    const page = await doc.getPage(p);
    // Same as the engine: cluster unrotated, rotate boxes onto the display.
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale: 1, rotation: 0 });

    const t0 = performance.now();
    const tc = await page.getTextContent();
    const lines = clusterTextItems(tc.items, viewport);
    if (rotation) {
      for (const ln of lines) {
        ln.box = rotateBox(ln.box, rotation);
        for (const w of ln.words) w.box = rotateBox(w.box, rotation);
      }
    }
    textMs.push(performance.now() - t0);
    lineCounts.push(lines.length);
    marginFlags += lines.filter((l) => l.kind === 'margin').length;

    if (canRaster) {
      const scale = Math.min(2.5, 1080 / viewport.width);
      const vp2 = page.getViewport({ scale });
      const { createCanvas } = require('@napi-rs/canvas');
      const canvas = createCanvas(Math.floor(vp2.width), Math.floor(vp2.height));
      const ctx = canvas.getContext('2d');
      const r0 = performance.now();
      await page.render({ canvasContext: ctx, viewport: vp2 }).promise;
      renderMs.push(performance.now() - r0);
      // Touch the pixels so the measurement isn't dead-code-eliminated.
      const png = await canvas.encode('jpeg', 85);
      if (png.length === 0) throw new Error('empty render');
    }

    if (p === 1) {
      console.log(`page 1 sample line: "${lines[0]?.text.slice(0, 48)}…" box=${JSON.stringify(lines[0]?.box)}`);
    }
    if (p === N) {
      console.log(`page ${N} (empty) lines: ${lines.length} (expect 0)`);
    }
  }

  console.log('--- S1 results (Node, indicative) ---');
  console.log(`text extract+cluster: p50=${percentile(textMs, 50).toFixed(1)}ms p95=${percentile(textMs, 95).toFixed(1)}ms/page`);
  console.log(`lines/page: min=${Math.min(...lineCounts)} max=${Math.max(...lineCounts)} median=${percentile(lineCounts, 50)}`);
  console.log(`margin-flagged lines total: ${marginFlags} (expect ~18 footers)`);
  if (canRaster) {
    console.log(`raster @≤2.5x: p50=${percentile(renderMs, 50).toFixed(1)}ms p95=${percentile(renderMs, 95).toFixed(1)}ms/page`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
