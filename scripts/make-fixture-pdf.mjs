#!/usr/bin/env node
/**
 * S1 spike fixture: generates a small synthetic multi-page TEXT pdf with
 * pdf-lib. Real selectable text (standard Helvetica), no images.
 *
 * Pages:
 *  1  cover/title page
 *  2  heading page (hierarchy of headings + short paragraphs)
 *  3-6 body pages: paragraphs of varying length
 *  7  dialogue page: many short lines (line-clustering exercise)
 *  8  empty page (blank; tests the no-text ruler path)
 *  9  rotated text: drawn at 90 degrees (tests viewport rotation handling)
 * 10  short mixed content (numbers, punctuation, headers/footers in margin zone)
 *
 * Output: assets/test-fixtures/folio-test.pdf (< 200 KB)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'assets', 'test-fixtures', 'folio-test.pdf');

const PAGE_W = 612; // US Letter
const PAGE_H = 792;
const MARGIN = 64;
const INK = rgb(0.12, 0.12, 0.12);
const MUTED = rgb(0.5, 0.5, 0.5);

const LOREM = [
  'Every book is a machine for slow thinking, and the reader is the operator. The Folio test fixture exists to make sure the operator can find every line of text, on every page, no matter how the page was composed.',
  'Typography carries meaning. A heading announces; a paragraph explains; a short line interrupts. A reader that cannot tell these apart is only pretending to read. This fixture checks that the line index treats each of them correctly.',
  'Consider the line as the unit of attention. Page turns are coarse. Paragraphs are arbitrary. But the line is where the eye actually rests, and any ruler that wants to guide the eye must know where each line begins and ends.',
  'The empty page is not a mistake. Real books contain blank leaves before chapters, after dedications, and at the end of signatures. The engine must not crash on them, must not invent lines, and must tell the ruler there is nothing to stand on.',
  'Rotation is the quiet trap of PDF text. Glyphs are placed with a transform, and the visible position is the transform multiplied by the page viewport. A line drawn at ninety degrees is still a line; the extractor must find it sideways.',
];

const DIALOGUE = [
  '— You said the reader would find every line.',
  '— I said it would try.',
  '"Try" is not a specification.',
  'It is the only honest one.',
  '— Then write a better one.',
  'Fine. A line is a maximal run of text items whose vertical extents overlap.',
  'That is circular.',
  'Only if you do not measure.',
];

function paragraph(font, page, text, y, size, opts = {}) {
  const maxWidth = PAGE_W - 2 * MARGIN;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const trial = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  for (const ln of lines) {
    page.drawText(ln, {
      x: MARGIN,
      y,
      size,
      font,
      color: opts.color ?? INK,
      maxWidth,
    });
    y -= size * 1.42;
  }
  return y;
}

const doc = await PDFDocument.create();
doc.setTitle('Folio Test Fixture');
doc.setAuthor('folio-spike-s1');
doc.setSubject('Synthetic text PDF for engine spike testing');

const regular = await doc.embedFont(StandardFonts.Helvetica);
const bold = await doc.embedFont(StandardFonts.HelveticaBold);
const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

// Page 1: cover
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 200;
  page.drawText('Folio Test Fixture', { x: MARGIN, y, size: 36, font: bold, color: INK });
  y -= 60;
  page.drawText('synthetic text pdf for the S1 engine spike', {
    x: MARGIN, y, size: 15, font: italic, color: MUTED,
  });
  y -= 50;
  y = paragraph(regular, page,
    'This document contains ten pages of real, selectable text: a cover, a heading hierarchy, body paragraphs, a dialogue page of short lines, an empty page, a page with text drawn at ninety degrees, and a short mixed page. It exists so the pdf.js engine spike can be measured, not admired.',
    y, 13);
  page.drawText('folio · spike S1 · offline only', { x: MARGIN, y: 56, size: 10, font: regular, color: MUTED });
}

// Page 2: heading hierarchy
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 110;
  const items = [
    [28, bold, 'Chapter One'],
    [13, regular, LOREM[1]],
    [20, bold, 'Section 1.1'],
    [13, regular, LOREM[2]],
    [16, bold, 'Subsection 1.1.1'],
    [13, regular, 'Headings nest. The line index should order them top to bottom, and the cluster step should never merge a heading into the paragraph beneath it when the vertical gap is clearly larger than the line height.'],
  ];
  for (const [size, font, text] of items) {
    if (size === 13) {
      y = paragraph(font, page, text, y, size);
    } else {
      page.drawText(text, { x: MARGIN, y, size, font, color: INK });
      y -= size * 1.6;
    }
    y -= 8;
  }
}

// Pages 3-6: body paragraphs
for (let p = 0; p < 4; p++) {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 110;
  page.drawText(`Body page ${p + 3}`, { x: MARGIN, y, size: 18, font: bold, color: INK });
  y -= 44;
  const paras = [LOREM[(p * 2) % LOREM.length], LOREM[(p * 2 + 1) % LOREM.length], LOREM[p % LOREM.length]];
  for (const para of paras) {
    y = paragraph(regular, page, para, y, 12.5);
    y -= 14;
  }
}

// Page 7: dialogue — many short lines
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - 110;
  page.drawText('Dialogue', { x: MARGIN, y, size: 18, font: bold, color: INK });
  y -= 48;
  for (const line of DIALOGUE) {
    page.drawText(line, { x: MARGIN + (line.startsWith('—') ? 0 : 18), y, size: 12.5, font: regular, color: INK });
    y -= 24;
  }
  y -= 16;
  y = paragraph(regular, page, 'Short lines are the hardest case for clustering: items that are far apart horizontally may still belong to one line, while items on adjacent rows must never merge. This page gives the extractor exactly that stress.', y, 12.5);
}

// Page 8: empty
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText('(intentionally blank)', {
    x: MARGIN, y: PAGE_H / 2, size: 10, font: italic, color: MUTED,
  });
}

// Page 9: rotated text at 90 degrees
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText('Rotated lines', { x: MARGIN, y: PAGE_H - 110, size: 18, font: bold, color: INK });
  const lines = [
    'This line was drawn with a ninety-degree rotation.',
    'The extractor must find it sideways, via the page viewport.',
    'Rotation is not magic; it is a matrix.',
  ];
  let y = PAGE_H - 220;
  for (const line of lines) {
    page.drawText(line, {
      x: MARGIN + 40,
      y,
      size: 13,
      font: regular,
      color: INK,
      rotate: degrees(90),
    });
    y -= 46;
  }
}

// Page 10: short mixed content with margin-zone header/footer
{
  const page = doc.addPage([PAGE_W, PAGE_H]);
  page.drawText('FOLIO TEST FIXTURE · HEADER', {
    x: MARGIN, y: PAGE_H - 40, size: 9, font: regular, color: MUTED,
  });
  let y = PAGE_H - 130;
  page.drawText('Last page', { x: MARGIN, y, size: 18, font: bold, color: INK });
  y -= 44;
  y = paragraph(regular, page, 'A short mixed page: numbers like 12345 and 3.14159, punctuation!!!, quotes "fine", and an em dash — all in one line to test tokenization.', y, 12.5);
  y -= 10;
  y = paragraph(regular, page, 'End of fixture.', y, 12.5);
  page.drawText('page 10 of 10', { x: PAGE_W - MARGIN - 60, y: 44, size: 9, font: regular, color: MUTED });
}

const bytes = await doc.save({ useObjectStreams: true });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`wrote ${OUT} (${bytes.length} bytes, ${doc.getPageCount()} pages)`);
