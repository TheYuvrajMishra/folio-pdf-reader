/**
 * lines.ts — text-line extraction from pdf.js getTextContent() items (PRD §7.4).
 *
 * Pipeline:
 *  1. Convert each item rect (e,f,w,h in PDF user space) with the viewport
 *     transform implemented in geometry.ts (handles rotation + CropBox).
 *  2. Sort by y0 then x0; cluster when vertical overlap > 50% of the
 *     smaller height.
 *  3. Within a line, order by x0 and merge into Line{idx, text, box, words[]};
 *     words via proportional split of str by char count × width.
 *  4. Drop empty/whitespace lines and tiny artifacts (height < 0.4 × median
 *     item height); flag kind:'margin' for lines centered in the top/bottom 6%.
 *
 * v1 assumes a single reading column (P2 adds column detection).
 * Platform-free: no react-native imports.
 */

import {
  pdfRectToNorm,
  unionNorm,
  verticalOverlap,
  type NormRect,
  type PageGeom,
} from '../util/geometry';

/** pdf.js getTextContent() item shape (the fields we use). */
export interface TextItem {
  str: string;
  /** [a,b,c,d,e,f]; e,f = item origin in PDF user space (y-up). */
  transform: [number, number, number, number, number, number];
  width: number;
  height: number;
}

export interface WordBox {
  text: string;
  /** Normalized box, top-left origin. */
  box: NormRect;
}

export interface Line {
  idx: number;
  text: string;
  /** Normalized box, top-left origin. */
  box: NormRect;
  words: WordBox[];
  kind: 'body' | 'margin';
}

interface PlacedItem {
  str: string;
  box: NormRect;
}

function boxHeight(b: NormRect): number {
  return b.y1 - b.y0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Split one item's str into word boxes, laid out left→right inside the item
 * box. Each word's width is proportional to its char count
 * (word.length / str.length × item width); leftover inter-word space is
 * distributed evenly across the gaps. Word boxes therefore tile the item box
 * horizontally.
 */
function buildWordBoxes(items: PlacedItem[]): WordBox[] {
  const words: WordBox[] = [];
  for (const item of items) {
    const parts = item.str.split(/\s+/).filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    const strLen = Math.max(1, item.str.length);
    const itemW = item.box.x1 - item.box.x0;
    const widths = parts.map((p) => itemW * (p.length / strLen));
    const used = widths.reduce((s, w) => s + w, 0);
    const gaps = parts.length - 1;
    const gapW = gaps > 0 ? Math.max(0, (itemW - used) / gaps) : 0;
    let cursor = item.box.x0;
    for (let i = 0; i < parts.length; i++) {
      words.push({
        text: parts[i],
        box: {
          x0: cursor,
          y0: item.box.y0,
          x1: cursor + widths[i],
          y1: item.box.y1,
        },
      });
      cursor += widths[i] + gapW;
    }
  }
  return words;
}

/**
 * Extract reading-ordered text lines from pdf.js text-content items.
 * Returns [] for pages with no (usable) text.
 */
export function extractLines(items: TextItem[], geom: PageGeom): Line[] {
  // 1. Convert item rects to normalized viewport coords.
  const placed: PlacedItem[] = [];
  for (const item of items) {
    const [, , , , e, f] = item.transform;
    // Item rect in PDF user space (y-up). Width/height are deltas in the
    // same space as e,f for our purposes.
    const norm = pdfRectToNorm(
      { x0: e, y0: f, x1: e + item.width, y1: f + item.height },
      geom,
    );
    if (!norm) continue; // degenerate page geometry — nothing sane to do
    placed.push({ str: item.str, box: norm });
  }
  if (placed.length === 0) return [];

  const medianH = median(placed.map((p) => boxHeight(p.box)));

  // 2. Sort by y0 then x0 (top-to-bottom, left-to-right in viewport space).
  placed.sort(
    (a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0,
  );

  // 3. Cluster: vertical overlap > 50% of the smaller height.
  interface Cluster {
    items: PlacedItem[];
    box: NormRect;
  }
  const clusters: Cluster[] = [];
  for (const p of placed) {
    let target: Cluster | null = null;
    for (const c of clusters) {
      const overlap = verticalOverlap(p.box, c.box);
      const smaller = Math.min(boxHeight(p.box), boxHeight(c.box));
      if (smaller > 0 && overlap > 0.5 * smaller) {
        target = c;
        break;
      }
    }
    if (target) {
      target.items.push(p);
      target.box = unionNorm(target.box, p.box);
    } else {
      clusters.push({ items: [p], box: { ...p.box } });
    }
  }
  // Clusters were appended in first-item y0 order → already top-to-bottom.

  // 4. Build lines: order within line by x0, merge text, split words,
  //    drop empties + tiny artifacts, flag margins.
  const lines: Line[] = [];
  for (const c of clusters) {
    const ordered = [...c.items].sort((a, b) => a.box.x0 - b.box.x0);
    const text = ordered.map((i) => i.str).join(' ');
    if (text.trim().length === 0) continue; // drop empty/whitespace lines
    const h = boxHeight(c.box);
    if (medianH > 0 && h < 0.4 * medianH) continue; // tiny artifact
    const centerY = (c.box.y0 + c.box.y1) / 2;
    const kind: Line['kind'] =
      centerY < 0.06 || centerY > 0.94 ? 'margin' : 'body';
    lines.push({
      idx: lines.length,
      text,
      box: { ...c.box },
      words: buildWordBoxes(ordered),
      kind,
    });
  }
  return lines;
}
