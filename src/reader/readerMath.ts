/**
 * readerMath.ts — platform-free reader geometry helpers (PRD §6.2, DESIGN §8).
 *
 * Pure functions, no react-native imports, safe for jest. The functions
 * marked with the 'worklet' directive are additionally callable from
 * Reanimated gesture worklets (the directive is inert under jest).
 */

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 5;
/** Double-tap toggles fit-width ↔ this. */
export const DOUBLE_TAP_ZOOM = 2.5;
/** Pinch ending above this with a low-res raster triggers the 2x upgrade. */
export const ZOOM_UPGRADE_THRESHOLD = 1.5;
/** Max raster scale (PRD §7.3 is 2.5; M1 ships tile-free at 2). */
export const MAX_RASTER_SCALE = 2;

/**
 * Raster scale for a page: min(2, screenWidthPx / pageWidthPt).
 * Returns 1 for degenerate input.
 */
export function pickRasterScale(pageWidthPt: number, screenWidthPx: number): number {
  if (!(pageWidthPt > 0) || !(screenWidthPx > 0)) return 1;
  return Math.min(MAX_RASTER_SCALE, screenWidthPx / pageWidthPt);
}

/** Tap-zone classification for DESIGN §8 (left 30% prev / right 30% next / center chrome). */
export type TapZone = 'prev' | 'next' | 'chrome';

export function classifyTapZone(x: number, width: number): TapZone {
  'worklet';
  if (!(width > 0)) return 'chrome';
  const frac = x / width;
  if (frac < 0.3) return 'prev';
  if (frac >= 0.7) return 'next';
  return 'chrome';
}

/** Clamp a zoom factor to the 1–5x range. */
export function clampZoom(zoom: number): number {
  'worklet';
  if (!(zoom > 0)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Double-tap target: back to fit when already zoomed past 1.25x. */
export function doubleTapZoomTarget(current: number): number {
  'worklet';
  return current > 1.25 ? MIN_ZOOM : DOUBLE_TAP_ZOOM;
}

/**
 * Scrubber mapping: drag x on a track of `trackWidth` → 1-based page.
 * Clamps to [1, pageCount].
 */
export function xToPage(x: number, trackWidth: number, pageCount: number): number {
  'worklet';
  if (pageCount <= 1) return 1;
  if (!(trackWidth > 0)) return 1;
  const clamped = Math.min(Math.max(x, 0), trackWidth);
  const page = 1 + (clamped / trackWidth) * (pageCount - 1);
  return Math.min(pageCount, Math.max(1, Math.round(page)));
}

/** Inverse of xToPage: thumb x for a 1-based page. */
export function pageToX(page: number, trackWidth: number, pageCount: number): number {
  'worklet';
  if (pageCount <= 1 || !(trackWidth > 0)) return 0;
  const p = Math.min(pageCount, Math.max(1, page));
  return ((p - 1) / (pageCount - 1)) * trackWidth;
}

/**
 * Prefetch window: pages within `radius` of the current page, excluding the
 * current page itself (PRD §6.2: current ±2). Empty at the edges as appropriate.
 */
export function prefetchWindow(page: number, pageCount: number, radius = 2): number[] {
  const out: number[] = [];
  if (!(pageCount >= 1) || !(radius >= 0)) return out;
  for (let d = -radius; d <= radius; d += 1) {
    if (d === 0) continue;
    const p = page + d;
    if (p >= 1 && p <= pageCount) out.push(p);
  }
  return out;
}
