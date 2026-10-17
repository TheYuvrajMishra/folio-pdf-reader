/**
 * pixelMode.ts — pixel-mode fallback for the reading ruler (PRD §6.5).
 *
 * For image-only (scan) pages there is no text layer, so the ruler runs on
 * detected text rows instead of Line boxes:
 *
 *   detectTextRows      — horizontal projection profile over a 25%-scale
 *                         grayscale bitmap: per-row darkness sums,
 *                         peak-picked with hysteresis. Returns normalized
 *                         (0..1) y-centers, top→bottom.
 *   rowProfileToRows    — same peak-pick, but from the engine's
 *                         get-row-profile response (rowSums + widthPx).
 *   pixelStep           — nearest-row stepping with the 3%-of-page-height
 *                         fixed fallback when detection found no rows.
 *
 * Platform-free: no react-native imports. Pure functions, fully unit-tested.
 */

/** Fixed fallback step (fraction of page height) when no rows are detected. */
export const PIXEL_FALLBACK_STEP = 0.03;

/** Hysteresis band edges, as fractions of (peak − background) darkness. */
const HIGH_FRAC = 0.35;
const LOW_FRAC = 0.15;
/** A row must stand this far above the background darkness to count. */
const MIN_SPAN = 0.02;
/** Rows taller than this fraction of the page are figures, not text. */
const MAX_ROW_HEIGHT_FRAC = 0.1;

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Horizontal projection profile: mean darkness per row, 0..1
 * (0 = all white, 1 = all black).
 */
export function profileFromGray(gray: Uint8Array, w: number, h: number): number[] {
  const dark = new Array<number>(h);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    const off = y * w;
    for (let x = 0; x < w; x++) {
      sum += 255 - gray[off + x];
    }
    dark[y] = sum / (w * 255);
  }
  return dark;
}

/**
 * Peak-pick text rows from a darkness profile with hysteresis
 * (Schmitt trigger): enter a row above `high`, leave below `low`, so ragged
 * text edges don't split one line into several.
 *
 * @returns normalized y-centers (0..1, top-left origin), top→bottom; []
 *   for blank pages or when nothing row-like is found.
 */
export function pickTextRows(dark: number[]): number[] {
  const h = dark.length;
  if (h === 0) return [];

  const base = median(dark);
  const peak = Math.max(...dark);
  const span = peak - base;
  if (!(span > MIN_SPAN)) return []; // blank page / uniform noise

  const high = base + HIGH_FRAC * span;
  const low = base + LOW_FRAC * span;

  interface Span {
    start: number;
    end: number;
  }
  const spans: Span[] = [];
  let start = -1;
  for (let y = 0; y < h; y++) {
    if (start < 0) {
      if (dark[y] >= high) start = y;
    } else if (dark[y] <= low) {
      spans.push({ start, end: y - 1 });
      start = -1;
    }
  }
  if (start >= 0) spans.push({ start, end: h - 1 });

  const rows: number[] = [];
  for (const s of spans) {
    const heightFrac = (s.end - s.start + 1) / h;
    if (heightFrac > MAX_ROW_HEIGHT_FRAC) continue; // figure, not a line
    const center = (s.start + s.end + 1) / 2 / h;
    rows.push(Math.min(1, Math.max(0, center)));
  }
  return rows;
}

/**
 * Detect text rows in a 25%-scale grayscale bitmap.
 *
 * @param gray row-major luminance bytes (0 = black, 255 = white), length ≥ w*h.
 */
export function detectTextRows(gray: Uint8Array, w: number, h: number): number[] {
  if (!(w > 0 && h > 0) || gray.length < w * h) return [];
  return pickTextRows(profileFromGray(gray, w, h));
}

/**
 * Peak-pick rows from an engine get-row-profile response: rowSums are raw
 * per-row darkness sums over widthPx pixels (each 0..255).
 */
export function rowProfileToRows(rowSums: number[], widthPx: number): number[] {
  if (!(widthPx > 0) || rowSums.length === 0) return [];
  const scale = widthPx * 255;
  return pickTextRows(rowSums.map((s) => s / scale));
}

export type PixelStep =
  /** Move the ruler to a detected row center (normalized y). */
  | { type: 'row'; y: number }
  /** No rows detected: fixed PIXEL_FALLBACK_STEP move (normalized y). */
  | { type: 'fallback'; y: number }
  /** Stepped past the top/bottom edge; caller turns the page. */
  | { type: 'page'; delta: 1 | -1 };

/**
 * Step the ruler in pixel mode. Rows are normalized y-centers (any order).
 * dir=1 (▼) moves to the nearest row strictly below currentY; past the last
 * row it crosses the page boundary. With no rows, the fixed 3% fallback
 * steps until it runs off the edge.
 */
export function pixelStep(rows: number[], currentY: number, dir: 1 | -1): PixelStep {
  const EPS = 1e-6;
  if (rows.length === 0) {
    const y = currentY + dir * PIXEL_FALLBACK_STEP;
    if (y > 1) return { type: 'page', delta: 1 };
    if (y < 0) return { type: 'page', delta: -1 };
    return { type: 'fallback', y: Math.min(1, Math.max(0, y)) };
  }
  const sorted = [...rows].sort((a, b) => a - b);
  if (dir === 1) {
    const next = sorted.find((y) => y > currentY + EPS);
    return next !== undefined ? { type: 'row', y: next } : { type: 'page', delta: 1 };
  }
  const prev = [...sorted].reverse().find((y) => y < currentY - EPS);
  return prev !== undefined ? { type: 'row', y: prev } : { type: 'page', delta: -1 };
}

/**
 * Estimate a text-line height (normalized) from detected row centers:
 * median inter-row gap, clamped to a sane band. Used for the pixel-mode
 * band box. Falls back to 2.5% of page height with < 2 rows.
 */
export function estimatePixelLineHeight(rows: number[]): number {
  const sorted = [...rows].sort((a, b) => a - b);
  if (sorted.length < 2) return 0.025;
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
  const m = median(gaps);
  return Math.min(0.06, Math.max(0.01, m));
}
