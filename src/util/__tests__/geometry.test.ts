/**
 * geometry.ts — normalized coords, rotation, CropBox (PRD §7.5).
 */
import {
  clamp01,
  cropToNorm,
  denormalizeRect,
  normalizeRect,
  normToScreen,
  rotateNormRect,
  screenToNorm,
  unionRect,
  verticalOverlap,
} from '../geometry';

describe('normalize / denormalize', () => {
  test('round-trips a rect', () => {
    const box = { w: 600, h: 800 };
    const n = normalizeRect(60, 80, 300, 400, box);
    expect(n).toEqual({ x0: 0.1, y0: 0.1, x1: 0.6, y1: 0.6 });
    const d = denormalizeRect(n, box);
    expect(d.x).toBeCloseTo(60);
    expect(d.y).toBeCloseTo(80);
    expect(d.w).toBeCloseTo(300);
    expect(d.h).toBeCloseTo(400);
  });

  test('clamps out-of-bounds rects', () => {
    const n = normalizeRect(-50, -50, 700, 900, { w: 600, h: 800 });
    expect(n).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });
});

describe('rotateNormRect', () => {
  const r = { x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 };
  test('0° is identity', () => {
    expect(rotateNormRect(r, 0)).toEqual(r);
  });
  test('90° then 270° round-trips', () => {
    const a = rotateNormRect(r, 90);
    const b = rotateNormRect(a, 270);
    expect(b.x0).toBeCloseTo(r.x0);
    expect(b.y0).toBeCloseTo(r.y0);
    expect(b.x1).toBeCloseTo(r.x1);
    expect(b.y1).toBeCloseTo(r.y1);
  });
  test('180° twice is identity', () => {
    const b = rotateNormRect(rotateNormRect(r, 180), 180);
    expect(b.x0).toBeCloseTo(r.x0);
    expect(b.y1).toBeCloseTo(r.y1);
  });
  test('90° maps top-left box toward top-right', () => {
    // A box at the top-left of an unrotated page appears at top-right
    // after a 90° clockwise rotation.
    const a = rotateNormRect({ x0: 0, y0: 0, x1: 0.2, y1: 0.2 }, 90);
    expect(a.x0).toBeCloseTo(0);
    expect(a.x1).toBeCloseTo(0.2);
    expect(a.y0).toBeCloseTo(0.8);
    expect(a.y1).toBeCloseTo(1);
  });
});

describe('cropToNorm', () => {
  test('CropBox == MediaBox is identity', () => {
    const mb = { x0: 0, y0: 0, x1: 612, y1: 792 };
    const n = cropToNorm({ x0: 61.2, y0: 79.2, x1: 122.4, y1: 158.4 }, mb, mb);
    expect(n.x0).toBeCloseTo(0.1);
    expect(n.y0).toBeCloseTo(0.1);
  });
  test('cropped page normalizes within the crop', () => {
    const mb = { x0: 0, y0: 0, x1: 612, y1: 792 };
    const crop = { x0: 56, y0: 56, x1: 556, y1: 736 }; // 500×680
    const n = cropToNorm({ x0: 56, y0: 56, x1: 556, y1: 736 }, mb, crop);
    expect(n).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    const half = cropToNorm({ x0: 56, y0: 56, x1: 306, y1: 396 }, mb, crop);
    expect(half.x1).toBeCloseTo(0.5);
    expect(half.y1).toBeCloseTo(0.5);
  });
});

describe('screen mapping', () => {
  const pageRect = { x: 10, y: 20, w: 400, h: 600 };
  test('norm → screen → norm round-trips', () => {
    const s = normToScreen({ x: 0.25, y: 0.5 }, pageRect);
    expect(s).toEqual({ x: 110, y: 320 });
    const n = screenToNorm(s, pageRect);
    expect(n.x).toBeCloseTo(0.25);
    expect(n.y).toBeCloseTo(0.5);
  });
});

describe('verticalOverlap / unionRect', () => {
  test('overlap ratio vs the smaller height', () => {
    const a = { x0: 0, y0: 0, x1: 1, y1: 0.1 };
    const b = { x0: 0, y0: 0.04, x1: 1, y1: 0.14 };
    expect(verticalOverlap(a, b)).toBeCloseTo(0.6);
    expect(verticalOverlap(a, { x0: 0, y0: 0.5, x1: 1, y1: 0.6 })).toBe(0);
  });
  test('unionRect bounds', () => {
    const u = unionRect([
      { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.3 },
      { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.4 },
    ]);
    expect(u).toEqual({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.4 });
    expect(unionRect([])).toBeNull();
  });
});

test('clamp01', () => {
  expect(clamp01(-2)).toBe(0);
  expect(clamp01(2)).toBe(1);
  expect(clamp01(0.5)).toBe(0.5);
});
