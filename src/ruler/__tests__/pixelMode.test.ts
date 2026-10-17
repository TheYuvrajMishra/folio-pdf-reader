/**
 * pixelMode.test.ts — unit tests for the pixel-mode fallback (PRD §6.5).
 * Pure functions; no mocks needed.
 */

import {
  PIXEL_FALLBACK_STEP,
  detectTextRows,
  estimatePixelLineHeight,
  pickTextRows,
  pixelStep,
  profileFromGray,
  rowProfileToRows,
} from '../pixelMode';

const W = 100;
const H = 20;

/** White page with solid black bands at the given row ranges. */
function bandedPage(bands: Array<[number, number]>, noise = false): Uint8Array {
  const gray = new Uint8Array(W * H).fill(255);
  for (const [y0, y1] of bands) {
    for (let y = y0; y <= y1; y++) {
      for (let x = 0; x < W; x++) gray[y * W + x] = 0;
    }
  }
  if (noise) {
    // Deterministic pseudo-random speckle (LCG) — stable across runs.
    let seed = 1234567;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < gray.length; i++) {
      if (rand() < 0.08) gray[i] = 255 - Math.floor(rand() * 120);
    }
  }
  return gray;
}

const TEXT_BANDS: Array<[number, number]> = [
  [4, 5],
  [10, 11],
  [15, 16],
];
/** Expected centers: (start+end+1)/2/H. */
const EXPECTED = [0.25, 0.55, 0.8];

describe('detectTextRows', () => {
  test('finds clear text rows', () => {
    const rows = detectTextRows(bandedPage(TEXT_BANDS), W, H);
    expect(rows).toHaveLength(3);
    rows.forEach((y, i) => expect(y).toBeCloseTo(EXPECTED[i], 2));
  });

  test('tolerates speckle noise', () => {
    const rows = detectTextRows(bandedPage(TEXT_BANDS, true), W, H);
    expect(rows).toHaveLength(3);
    rows.forEach((y, i) => expect(Math.abs(y - EXPECTED[i])).toBeLessThan(0.04));
  });

  test('blank page → []', () => {
    expect(detectTextRows(new Uint8Array(W * H).fill(255), W, H)).toEqual([]);
  });

  test('uniform mid-gray page → []', () => {
    expect(detectTextRows(new Uint8Array(W * H).fill(200), W, H)).toEqual([]);
  });

  test('degenerate input → []', () => {
    expect(detectTextRows(new Uint8Array(10), 0, 20)).toEqual([]);
    expect(detectTextRows(new Uint8Array(10), W, H)).toEqual([]);
  });

  test('giant dark figure region is not a text row', () => {
    // 8 of 20 rows solid black = 40% of the page → figure, dropped.
    const rows = detectTextRows(bandedPage([[6, 13]]), W, H);
    expect(rows).toEqual([]);
  });

  test('profileFromGray + pickTextRows compose to the same result', () => {
    const gray = bandedPage(TEXT_BANDS);
    const via = pickTextRows(profileFromGray(gray, W, H));
    expect(via).toEqual(detectTextRows(gray, W, H));
  });
});

describe('rowProfileToRows', () => {
  test('peak-picks from engine row sums', () => {
    const darkSum = Math.round(0.3 * W * 255);
    const sums = new Array(H).fill(0);
    for (const [y0, y1] of TEXT_BANDS) {
      for (let y = y0; y <= y1; y++) sums[y] = darkSum;
    }
    const rows = rowProfileToRows(sums, W);
    expect(rows).toHaveLength(3);
    rows.forEach((y, i) => expect(y).toBeCloseTo(EXPECTED[i], 2));
  });

  test('empty sums / zero width → []', () => {
    expect(rowProfileToRows([], W)).toEqual([]);
    expect(rowProfileToRows([1, 2, 3], 0)).toEqual([]);
  });
});

describe('pixelStep', () => {
  const rows = [0.25, 0.55, 0.8];

  test('▼ moves to the nearest row below', () => {
    expect(pixelStep(rows, 0.0, 1)).toEqual({ type: 'row', y: 0.25 });
    expect(pixelStep(rows, 0.25, 1)).toEqual({ type: 'row', y: 0.55 });
    expect(pixelStep(rows, 0.4, 1)).toEqual({ type: 'row', y: 0.55 });
  });

  test('▲ moves to the nearest row above', () => {
    expect(pixelStep(rows, 0.9, -1)).toEqual({ type: 'row', y: 0.8 });
    expect(pixelStep(rows, 0.8, -1)).toEqual({ type: 'row', y: 0.55 });
    expect(pixelStep(rows, 0.6, -1)).toEqual({ type: 'row', y: 0.55 });
  });

  test('past the last/first row → page edge', () => {
    expect(pixelStep(rows, 0.8, 1)).toEqual({ type: 'page', delta: 1 });
    expect(pixelStep(rows, 0.25, -1)).toEqual({ type: 'page', delta: -1 });
  });

  test('unsorted rows are handled', () => {
    expect(pixelStep([0.8, 0.25, 0.55], 0.0, 1)).toEqual({ type: 'row', y: 0.25 });
  });

  test('3% fixed fallback when detection found no rows', () => {
    expect(pixelStep([], 0.5, 1)).toEqual({
      type: 'fallback',
      y: 0.5 + PIXEL_FALLBACK_STEP,
    });
    expect(pixelStep([], 0.5, -1)).toEqual({
      type: 'fallback',
      y: 0.5 - PIXEL_FALLBACK_STEP,
    });
    expect(PIXEL_FALLBACK_STEP).toBe(0.03);
  });

  test('fallback runs off the edge → page', () => {
    expect(pixelStep([], 0.99, 1)).toEqual({ type: 'page', delta: 1 });
    expect(pixelStep([], 0.01, -1)).toEqual({ type: 'page', delta: -1 });
  });
});

describe('estimatePixelLineHeight', () => {
  test('median gap, clamped', () => {
    // Median gap 0.275 → clamped to the 0.06 ceiling.
    expect(estimatePixelLineHeight([0.25, 0.55, 0.8])).toBe(0.06);
    expect(estimatePixelLineHeight([0.2, 0.23, 0.26])).toBeCloseTo(0.03, 3);
  });

  test('fewer than 2 rows → default', () => {
    expect(estimatePixelLineHeight([])).toBe(0.025);
    expect(estimatePixelLineHeight([0.5])).toBe(0.025);
  });
});
