/**
 * pen.ts — freehand pen geometry for Folio annotations (PRD §6.6).
 *
 * - `simplifyPolyline`: Douglas-Peucker polyline simplification, default
 *   ε = 0.0005 in normalized page coords (PRD §6.6 storage format).
 * - `hitTestStroke`: eraser hit-test — true when `point` is within `radius`
 *   (normalized units) of any stroke segment (whole-stroke erase).
 *
 * Platform-free: no react-native imports. Pure functions, unit-tested.
 */

/** A point in normalized page coords (0..1, top-left origin). */
export interface NormPoint {
  x: number;
  y: number;
}

/** Squared distance from point p to segment a→b (normalized units²). */
function distToSegmentSq(p: NormPoint, a: NormPoint, b: NormPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  );
  const ex = p.x - (a.x + t * dx);
  const ey = p.y - (a.y + t * dy);
  return ex * ex + ey * ey;
}

/**
 * Douglas-Peucker simplification (iterative, no recursion).
 *
 * Keeps the first and last points always; drops points whose perpendicular
 * distance to the current anchor chord is ≤ `eps`. Default ε = 0.0005
 * matches the PRD §6.6 storage format for pen strokes.
 *
 * Returns a new array (input untouched); points are passed through by
 * reference. Fewer than 3 points are returned as a copy, unchanged.
 */
export function simplifyPolyline(
  points: NormPoint[],
  eps = 0.0005,
): NormPoint[] {
  const n = points.length;
  if (n <= 2) return [...points];
  const eps2 = eps * eps;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  // Stack of (start, end) index pairs still to process.
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const a = points[s];
    const b = points[e];
    let maxD2 = 0;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d2 = distToSegmentSq(points[i], a, b);
      if (d2 > maxD2) {
        maxD2 = d2;
        maxI = i;
      }
    }
    if (maxI !== -1 && maxD2 > eps2) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  const out: NormPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/**
 * Eraser hit-test: true when `point` lies within `radius` of any segment of
 * the stroke polyline (whole-stroke erase per PRD §6.6). `radius` is in
 * normalized page units — convert the eraser's screen radius via the page
 * size before calling.
 */
export function hitTestStroke(
  polyline: NormPoint[],
  point: NormPoint,
  radius: number,
): boolean {
  if (polyline.length === 0) return false;
  const r2 = radius * radius;
  if (polyline.length === 1) {
    return distToSegmentSq(point, polyline[0], polyline[0]) <= r2;
  }
  for (let i = 0; i < polyline.length - 1; i++) {
    if (distToSegmentSq(point, polyline[i], polyline[i + 1]) <= r2) {
      return true;
    }
  }
  return false;
}
