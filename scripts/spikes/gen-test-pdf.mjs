#!/usr/bin/env node
/**
 * Generates the M0 spike fixture: a 20-page PDF with real text.
 * Pages 1–18: heading + ~40 text lines + page-number footer (margin test).
 * Page 19: /Rotate 90 with text (rotation test).
 * Page 20: empty (image-only simulation — no text layer).
 * Output: scripts/spikes/fixtures/test-book.pdf (gitignored; regenerated).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'fixtures');
const outFile = path.join(outDir, 'test-book.pdf');

const LOREM =
  'The quick brown fox jumps over the lazy dog near the riverbank at dawn, while scholars debate the meaning of marginalia in ancient codices. ';

async function main() {
  const doc = await PDFDocument.create();
  doc.setTitle('Folio Spike Test Book');
  doc.setAuthor('Folio Spike Harness');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  for (let p = 1; p <= 18; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Chapter ${p} — On Reading`, {
      x: 72, y: 720, size: 20, font: fontBold, color: rgb(0.1, 0.1, 0.1),
    });
    let y = 690;
    for (let l = 0; l < 40; l++) {
      const words = 8 + ((p * 7 + l * 13) % 9);
      page.drawText(LOREM.repeat(2).split(' ').slice(0, words).join(' '), {
        x: 72, y, size: 11, font, color: rgb(0.15, 0.15, 0.15),
      });
      y -= 15;
      if (y < 60) break;
    }
    // Footer inside the bottom 6% → should be flagged kind:'margin'.
    page.drawText(`${p}`, { x: 300, y: 30, size: 10, font, color: rgb(0.4, 0.4, 0.4) });
  }

  // Rotated page.
  const rp = doc.addPage([612, 792]);
  rp.setRotation(degrees(90));
  rp.drawText('This page is rotated 90 degrees.', {
    x: 72, y: 700, size: 14, font: fontBold, color: rgb(0.1, 0.1, 0.1),
  });
  for (let l = 0; l < 20; l++) {
    rp.drawText(`Rotated line ${l + 1} — the fox still jumps.`, {
      x: 72, y: 670 - l * 16, size: 11, font, color: rgb(0.15, 0.15, 0.15),
    });
  }

  // Empty page (no text layer).
  doc.addPage([612, 792]);

  const bytes = await doc.save();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, bytes);
  console.log(`wrote ${outFile} (${(bytes.length / 1024).toFixed(1)} KiB, 20 pages)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
