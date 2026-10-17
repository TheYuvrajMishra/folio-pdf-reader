/**
 * selection.ts — text-snapped selection for Folio annotations (PRD §6.6).
 *
 * `snapSelection(lines, p0, p1)` converts a drag (anchor p0 → active p1,
 * normalized page coords) into per-line segment rects built from the page's
 * word boxes:
 *  - drag within one line → rect spanning the snapped char range;
 *  - drag across lines → partial first/last lines (proportional char split
 *    inside the boundary words) and full rects for lines in between;
 *  - backwards drags (active above the anchor) normalize to the same rects
 *    as the equivalent forward drag.
 *
 * Per the gestures map (DESIGN §8), a long-press sets the anchor; p0 is that
 * anchor point, p1 the current drag position. Direction of drag does not
 * matter — the selection always runs in reading order (top line → bottom).
 *
 * Platform-free: no react-native imports. Pure function, unit-tested.
 */

import type { Line } from '../engine/lines';
import type { NormRect } from '../util/geometry';
import type { NormPoint } from './pen';

/** X of the char boundary in `line` nearest to normalized x `x`. */
function snapCharX(line: Line, x: number): number {
  const words = line.words;
  const box = line.box;
  if (words.length === 0) {
    return Math.max(box.x0, Math.min(box.x1, x));
  }
  const first = words[0];
  const last = words[words.length - 1];
  if (x <= first.box.x0) return Math.max(box.x0, first.box.x0);
  if (x >= last.box.x1) return Math.min(box.x1, last.box.x1);
  for (const w of words) {
    const wb = w.box;
    const wW = wb.x1 - wb.x0;
    if (x >= wb.x0 && x <= wb.x1 && wW > 0 && w.text.length > 0) {
      // Proportional char split inside the boundary word.
      const frac = (x - wb.x0) / wW;
      const chars = Math.round(frac * w.text.length);
      return wb.x0 + wW * (chars / w.text.length);
    }
    // x in the gap between this word and the next: snap to nearest edge.
  }
  // x fell in an inter-word gap: snap to the closest word edge.
  let best = first.box.x0;
  let bestD = Infinity;
  for (const w of words) {
    for (const edge of [w.box.x0, w.box.x1]) {
      const d = Math.abs(x - edge);
      if (d < bestD) {
        bestD = d;
        best = edge;
      }
    }
  }
  return best;
}

/**
 * Build per-line selection rects for a drag from `p0` (anchor) to `p1`
 * (active) over `lines` (any order; sorted top→bottom internally).
 * Returns [] when the drag touches no line.
 */
export function snapSelection(
  lines: Line[],
  p0: NormPoint,
  p1: NormPoint,
): NormRect[] {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => a.box.y0 - b.box.y0);
  const yLo = Math.min(p0.y, p1.y);
  const yHi = Math.max(p0.y, p1.y);
  // Lines whose box overlaps the drag's vertical span.
  const covered = sorted.filter(
    (l) => l.box.y0 <= yHi && l.box.y1 >= yLo,
  );
  if (covered.length === 0) return [];

  // Reading order: selection runs top line → bottom line regardless of
  // drag direction. The boundary x on the top line comes from the point
  // with the smaller y (the anchor when dragging down), and on the bottom
  // line from the point with the larger y.
  const topX = p0.y <= p1.y ? p0.x : p1.x;
  const bottomX = p0.y <= p1.y ? p1.x : p0.x;

  const rects: NormRect[] = [];
  const first = covered[0];
  const last = covered[covered.length - 1];

  if (covered.length === 1) {
    const x0 = snapCharX(first, Math.min(topX, bottomX));
    const x1 = snapCharX(first, Math.max(topX, bottomX));
    if (x1 > x0) {
      rects.push({ x0, y0: first.box.y0, x1, y1: first.box.y1 });
    }
    return rects;
  }

  // First (top) line: from the anchor char to end of line.
  {
    const x0 = snapCharX(first, topX);
    const x1 = first.box.x1;
    if (x1 > x0) rects.push({ x0, y0: first.box.y0, x1, y1: first.box.y1 });
  }
  // Middle lines: full line rects.
  for (let i = 1; i < covered.length - 1; i++) {
    rects.push({ ...covered[i].box });
  }
  // Last (bottom) line: from line start to the active char.
  {
    const x0 = last.box.x0;
    const x1 = snapCharX(last, bottomX);
    if (x1 > x0) rects.push({ x0, y0: last.box.y0, x1, y1: last.box.y1 });
  }
  return rects;
}
