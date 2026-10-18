/**
 * geometry.ts — owns ALL coordinate conversion (PRD §7.5).
 * Everything overlay/annotation uses normalized page coords (0..1,
 * top-left origin). Screen transform = norm × pageRectOnScreen
 * (includes zoom/pan). Unit-tested incl. rotated pages and CropBox.
 */

export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}
/** Clockwise page rotation in degrees (PDF /Rotate). */
export type Rotation = 0 | 90 | 180 | 270;

/** Clamp a value into 0..1. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Normalize a pixel rect inside a box of size w×h → 0..1 rect. */
export function normalizeRect(x: number, y: number, w: number, h: number, box: Size): NormRect {
  return {
    x0: clamp01(x / box.w),
    y0: clamp01(y / box.h),
    x1: clamp01((x + w) / box.w),
    y1: clamp01((y + h) / box.h),
  };
}

/** Denormalize: norm rect → pixel rect inside a box of size w×h. */
export function denormalizeRect(r: NormRect, box: Size): { x: number; y: number; w: number; h: number } {
  return {
    x: r.x0 * box.w,
    y: r.y0 * box.h,
    w: (r.x1 - r.x0) * box.w,
    h: (r.y1 - r.y0) * box.h,
  };
}

/**
 * Rotate a normalized rect for a page with /Rotate applied.
 * Rotation is clockwise in PDF user space; the visible (viewport) coords
 * rotate with it. Matches pdf.js viewport.convertToViewportRectangle
 * semantics for the 90/180/270 cases on an un-cropped page.
 */
export function rotateNormRect(r: NormRect, rotation: Rotation): NormRect {
  switch (rotation) {
    case 0:
      return { ...r };
    case 90:
      return { x0: r.y0, y0: 1 - r.x1, x1: r.y1, y1: 1 - r.x0 };
    case 180:
      return { x0: 1 - r.x1, y0: 1 - r.y1, x1: 1 - r.x0, y1: 1 - r.y0 };
    case 270:
      return { x0: 1 - r.y1, y0: r.x0, x1: 1 - r.y0, y1: r.x1 };
  }
}

/**
 * CropBox handling: pdf.js viewports already account for CropBox, but the
 * text-line extractor (S1) receives raw user-space rects. Convert a
 * MediaBox-space rect into CropBox-normalized 0..1 coords.
 */
export function cropToNorm(
  r: { x0: number; y0: number; x1: number; y1: number },
  mediaBox: { x0: number; y0: number; x1: number; y1: number },
  cropBox: { x0: number; y0: number; x1: number; y1: number },
): NormRect {
  const cw = cropBox.x1 - cropBox.x0;
  const ch = cropBox.y1 - cropBox.y0;
  void mediaBox; // MediaBox only defines the outer bound; crop is authoritative.
  return {
    x0: clamp01((r.x0 - cropBox.x0) / cw),
    y0: clamp01((r.y0 - cropBox.y0) / ch),
    x1: clamp01((r.x1 - cropBox.x0) / cw),
    y1: clamp01((r.y1 - cropBox.y0) / ch),
  };
}

/**
 * Screen mapping: norm point → screen px given the on-screen page rect
 * (already includes zoom + pan + device pixel ratio handling by caller).
 */
export function normToScreen(p: Pt, pageRect: { x: number; y: number; w: number; h: number }): Pt {
  return { x: pageRect.x + p.x * pageRect.w, y: pageRect.y + p.y * pageRect.h };
}

export function screenToNorm(p: Pt, pageRect: { x: number; y: number; w: number; h: number }): Pt {
  return {
    x: clamp01((p.x - pageRect.x) / pageRect.w),
    y: clamp01((p.y - pageRect.y) / pageRect.h),
  };
}

/** Vertical overlap ratio of two norm rects relative to the smaller height. */
export function verticalOverlap(a: NormRect, b: NormRect): number {
  const top = Math.max(a.y0, b.y0);
  const bottom = Math.min(a.y1, b.y1);
  const overlap = Math.max(0, bottom - top);
  const smaller = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return smaller <= 0 ? 0 : overlap / smaller;
}

/** Union of rects (for multi-rect highlight bounds). */
export function unionRect(rects: NormRect[]): NormRect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x0);
    y0 = Math.min(y0, r.y0);
    x1 = Math.max(x1, r.x1);
    y1 = Math.max(y1, r.y1);
  }
  return { x0, y0, x1, y1 };
}
