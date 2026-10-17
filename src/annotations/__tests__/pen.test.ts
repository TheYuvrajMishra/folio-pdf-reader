import { hitTestStroke, simplifyPolyline, type NormPoint } from '../pen';

const pt = (x: number, y: number): NormPoint => ({ x, y });

describe('simplifyPolyline (Douglas-Peucker, eps=0.0005)', () => {
  test('collinear points collapse to the two endpoints', () => {
    const line: NormPoint[] = [];
    for (let i = 0; i <= 20; i++) line.push(pt(i / 20, 0.5));
    const out = simplifyPolyline(line);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(pt(0, 0.5));
    expect(out[1]).toEqual(pt(1, 0.5));
  });

  test('default eps drops sub-pixel jitter but keeps real corners', () => {
    // Square-ish stroke with tiny jitter along the edges.
    const pts: NormPoint[] = [
      pt(0, 0),
      pt(0.25, 0.0004),
      pt(0.5, -0.0003),
      pt(0.75, 0.0004),
      pt(1, 0),
      pt(1, 0.25),
      pt(1, 0.5),
      pt(1, 0.75),
      pt(1, 1),
    ];
    const out = simplifyPolyline(pts);
    // Jitter (< eps) gone; the corner (1,0) kept.
    expect(out).toEqual([pt(0, 0), pt(1, 0), pt(1, 1)]);
  });

  test('larger eps simplifies more aggressively', () => {
    const pts = [pt(0, 0), pt(0.5, 0.05), pt(1, 0)];
    expect(simplifyPolyline(pts, 0.1)).toEqual([pt(0, 0), pt(1, 0)]);
    expect(simplifyPolyline(pts, 0.01)).toHaveLength(3);
  });

  test('fewer than 3 points are returned as a copy, unchanged', () => {
    expect(simplifyPolyline([])).toEqual([]);
    const one = [pt(0.1, 0.2)];
    expect(simplifyPolyline(one)).toEqual(one);
    expect(simplifyPolyline(one)).not.toBe(one);
    const two = [pt(0, 0), pt(1, 1)];
    expect(simplifyPolyline(two)).toEqual(two);
  });

  test('input array is not mutated', () => {
    const pts = [pt(0, 0), pt(0.5, 0), pt(1, 0)];
    const before = JSON.stringify(pts);
    simplifyPolyline(pts);
    expect(JSON.stringify(pts)).toBe(before);
  });

  test('closed loop keeps its shape', () => {
    const pts = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1), pt(0, 0)];
    expect(simplifyPolyline(pts)).toEqual(pts);
  });
});

describe('hitTestStroke (eraser, whole-stroke)', () => {
  const stroke = [pt(0.1, 0.1), pt(0.5, 0.5), pt(0.9, 0.1)];

  test('point on the stroke hits', () => {
    expect(hitTestStroke(stroke, pt(0.5, 0.5), 0.01)).toBe(true);
    expect(hitTestStroke(stroke, pt(0.3, 0.3), 0.01)).toBe(true);
  });

  test('point within radius of the stroke hits', () => {
    expect(hitTestStroke(stroke, pt(0.5, 0.55), 0.06)).toBe(true);
  });

  test('point outside radius misses', () => {
    expect(hitTestStroke(stroke, pt(0.5, 0.7), 0.05)).toBe(false);
  });

  test('endpoints count as part of the stroke', () => {
    expect(hitTestStroke(stroke, pt(0.1, 0.1), 0.001)).toBe(true);
    expect(hitTestStroke(stroke, pt(0.9, 0.1), 0.001)).toBe(true);
  });

  test('degenerate inputs', () => {
    expect(hitTestStroke([], pt(0.5, 0.5), 0.1)).toBe(false);
    expect(hitTestStroke([pt(0.5, 0.5)], pt(0.5, 0.51), 0.02)).toBe(true);
    expect(hitTestStroke([pt(0.5, 0.5)], pt(0.5, 0.6), 0.02)).toBe(false);
    // zero-length segment in the middle does not crash
    expect(hitTestStroke([pt(0, 0), pt(0, 0), pt(1, 0)], pt(0.5, 0), 0.01)).toBe(
      true,
    );
  });
});
