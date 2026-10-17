/**
 * renderLayout.ts — pure layout math for the annotation overlay.
 *
 * Converts annotation geometry (normalized page coords, 0..1) to screen
 * coordinates via a caller-supplied `toScreen` mapper (which encodes the
 * page's on-screen rect: zoom + pan already baked in). Kept separate from
 * renderers.tsx so the math is unit-testable without the Skia runtime.
 *
 * Platform-free: no react-native / Skia imports.
 */

import {
  normToScreen,
  type NormRect,
  type PageRectOnScreen,
} from '../util/geometry';
import type { NormPoint } from './pen';
import type { Annotation } from './store';

/** Screen-space rect in dp (x0 < x1, y0 < y1). */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Screen-space point in dp. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Map a normalized rect to screen dp. Null when the page rect is degenerate. */
export type ToScreen = (rect: NormRect) => ScreenRect | null;

/** Build a ToScreen mapper from the page's on-screen rect (zoom/pan baked in). */
export function toScreenFromPageRect(page: PageRectOnScreen): ToScreen {
  return (rect: NormRect) => {
    const s = normToScreen(rect, page);
    return s ? { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 } : null;
  };
}

/** Map a normalized point through a ToScreen mapper (degenerate rect trick). */
export function pointToScreen(
  toScreen: ToScreen,
  p: NormPoint,
): ScreenPoint | null {
  const s = toScreen({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  return s ? { x: s.x0, y: s.y0 } : null;
}

/**
 * Screen rects for rect-based annotation types (highlight, underline,
 * strike, rect). Null entries are dropped. `rects` may be undefined
 * (e.g. a malformed row) → [].
 */
export function rectsToScreen(
  annotation: Annotation,
  toScreen: ToScreen,
): ScreenRect[] {
  const rects = annotation.dataJson.rects;
  if (!rects || rects.length === 0) return [];
  const out: ScreenRect[] = [];
  for (const r of rects) {
    const s = toScreen(r);
    if (s) out.push(s);
  }
  return out;
}

/** Screen polyline for pen strokes. */
export function polylineToScreen(
  annotation: Annotation,
  toScreen: ToScreen,
): ScreenPoint[] {
  const line = annotation.dataJson.polyline;
  if (!line || line.length === 0) return [];
  const out: ScreenPoint[] = [];
  for (const p of line) {
    const s = pointToScreen(toScreen, p);
    if (s) out.push(s);
  }
  return out;
}

/** Screen anchor for a note pin. Null when the annotation has no anchor. */
export function noteAnchorToScreen(
  annotation: Annotation,
  toScreen: ToScreen,
): ScreenPoint | null {
  const anchor = annotation.dataJson.noteAnchor;
  return anchor ? pointToScreen(toScreen, anchor) : null;
}

/**
 * Corner ribbon triangle for a page-level bookmark, as three screen points
 * at the page's top-right corner. Ribbon leg length scales with the page's
 * on-screen size (~9% of the smaller page dimension).
 */
export function bookmarkRibbon(
  toScreen: ToScreen,
): [ScreenPoint, ScreenPoint, ScreenPoint] | null {
  const corner = pointToScreen(toScreen, { x: 1, y: 0 });
  const origin = pointToScreen(toScreen, { x: 0, y: 0 });
  const bottom = pointToScreen(toScreen, { x: 0, y: 1 });
  if (!corner || !origin || !bottom) return null;
  const leg = Math.min(corner.x - origin.x, bottom.y - origin.y) * 0.09;
  if (!(leg > 0)) return null;
  return [
    { x: corner.x - leg, y: corner.y },
    { x: corner.x, y: corner.y },
    { x: corner.x, y: corner.y + leg },
  ];
}

/**
 * Union (bounding) rect of a rect list in screen space — used for the
 * underline rule (bottom edge) and strike line (vertical center).
 */
export function unionScreenRect(rects: ScreenRect[]): ScreenRect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}
