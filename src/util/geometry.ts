/**
 * geometry.ts — the single owner of coordinate conversions for Folio (PRD §7.5).
 *
 * Platform-free: no react-native imports. All overlay/annotation coordinates are
 * normalized page coords (0..1, top-left origin). Screen mapping is
 * `norm × pageRectOnScreen`, which already encodes zoom/pan.
 *
 * PDF user space (input to pdfRectToNorm): unrotated, y-up, in points.
 * The page geometry carries MediaBox size + CropBox offset/size + rotation,
 * mirroring how pdf.js `PageViewport` combines view (CropBox) and rotate.
 */

/** Rect in PDF user space: unrotated, y-up, points. */
export interface PdfRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Rect in normalized page coords: 0..1, top-left origin (y-down). */
export interface NormRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** On-screen rect of the whole page (encodes zoom + pan). */
export interface PageRectOnScreen {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * CropBox within the MediaBox, in PDF user space (y-up, points).
 * Defaults to the full MediaBox when omitted.
 */
export interface CropBox {
  /** Lower-left x offset within the MediaBox. */
  x: number;
  /** Lower-left y offset within the MediaBox. */
  y: number;
  /** CropBox width. */
  w: number;
  /** CropBox height. */
  h: number;
}

export interface PageGeom {
  /** MediaBox width (unrotated), points. */
  mediaW: number;
  /** MediaBox height (unrotated), points. */
  mediaH: number;
  /** CropBox; defaults to the full MediaBox. */
  crop?: CropBox;
  /** Page rotation, clockwise as in PDF /Rotate. Defaults to 0. */
  rotation?: Rotation;
}

function isRotation(r: number): r is Rotation {
  return r === 0 || r === 90 || r === 180 || r === 270;
}

/**
 * Convert a PDF user-space rect (y-up, unrotated) to normalized page coords
 * (0..1, top-left origin), handling page rotation and CropBox ≠ MediaBox.
 *
 * Normalization is against the CROP box (the visible page), with the crop
 * width/height swapped for 90°/270° rotations — the same space pdf.js
 * `PageViewport` produces.
 *
 * Returns null when the page geometry is degenerate (crop width/height ≤ 0).
 * Throws on unsupported rotation values (programming error).
 * Values may fall outside 0..1 if the rect lies outside the crop box
 * (no clipping applied).
 */
export function pdfRectToNorm(rect: PdfRect, geom: PageGeom): NormRect | null {
  const rotation = geom.rotation ?? 0;
  if (!isRotation(rotation)) {
    throw new Error(
      `geometry.pdfRectToNorm: unsupported rotation ${rotation}; expected 0|90|180|270`,
    );
  }
  const crop: CropBox = geom.crop ?? {
    x: 0,
    y: 0,
    w: geom.mediaW,
    h: geom.mediaH,
  };
  if (!(crop.w > 0 && crop.h > 0)) {
    return null; // degenerate page geometry
  }
  const cx0 = crop.x;
  const cy0 = crop.y;
  const cx1 = crop.x + crop.w;
  const cy1 = crop.y + crop.h;

  // Viewport dims: swapped for 90°/270° (what the user sees).
  const swapped = rotation === 90 || rotation === 270;
  const vw = swapped ? crop.h : crop.w;
  const vh = swapped ? crop.w : crop.h;

  // PDF user space (x,y) -> viewport (vx,vy), y-down. Derived from the
  // pdf.js PageViewport transform (verified against its source).
  const map = (x: number, y: number): [number, number] => {
    switch (rotation) {
      case 0:
        return [x - cx0, cy1 - y];
      case 90:
        return [y - cy0, x - cx0];
      case 180:
        return [cx1 - x, y - cy0];
      case 270:
        return [cy1 - y, cx1 - x];
    }
  };

  const corners: Array<[number, number]> = [
    map(rect.x0, rect.y0),
    map(rect.x1, rect.y0),
    map(rect.x0, rect.y1),
    map(rect.x1, rect.y1),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.min(...xs) / vw,
    y0: Math.min(...ys) / vh,
    x1: Math.max(...xs) / vw,
    y1: Math.max(...ys) / vh,
  };
}

/**
 * Map a normalized rect to screen coords via the on-screen page rect
 * (zoom/pan already baked into `page`). Returns null when the page rect
 * is degenerate (width/height ≤ 0 or NaN).
 */
export function normToScreen(
  norm: NormRect,
  page: PageRectOnScreen,
): NormRect | null {
  if (!(page.width > 0 && page.height > 0)) {
    return null; // degenerate page rect
  }
  return {
    x0: page.x + norm.x0 * page.width,
    y0: page.y + norm.y0 * page.height,
    x1: page.x + norm.x1 * page.width,
    y1: page.y + norm.y1 * page.height,
  };
}

/**
 * Inverse of normToScreen. Returns null when the page rect is degenerate.
 * The result may lie outside 0..1 when the screen point is off the page.
 */
export function screenToNorm(
  screen: NormRect,
  page: PageRectOnScreen,
): NormRect | null {
  if (!(page.width > 0 && page.height > 0)) {
    return null; // degenerate page rect
  }
  return {
    x0: (screen.x0 - page.x) / page.width,
    y0: (screen.y0 - page.y) / page.height,
    x1: (screen.x1 - page.x) / page.width,
    y1: (screen.y1 - page.y) / page.height,
  };
}

/** Union of two normalized rects. */
export function unionNorm(a: NormRect, b: NormRect): NormRect {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/** Vertical overlap of two normalized rects (0 when disjoint). */
export function verticalOverlap(a: NormRect, b: NormRect): number {
  return Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
}
