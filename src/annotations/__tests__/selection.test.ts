import type { Line, WordBox } from '../../engine/lines';
import type { NormRect } from '../../util/geometry';
import { snapSelection } from '../selection';
import type { NormPoint } from '../pen';

const LH = 0.03; // line height in normalized units

function makeLine(
  idx: number,
  y0: number,
  words: Array<[string, number, number]>,
): Line {
  const boxes: WordBox[] = words.map(([text, x0, x1]) => ({
    text,
    box: { x0, y0, x1, y1: y0 + LH },
  }));
  return {
    idx,
    text: words.map((w) => w[0]).join(' '),
    box: {
      x0: words[0][1],
      y0,
      x1: words[words.length - 1][2],
      y1: y0 + LH,
    },
    words: boxes,
    kind: 'body',
  };
}

const pt = (x: number, y: number): NormPoint => ({ x, y });

const PAGE: Line[] = [
  makeLine(0, 0.1, [
    ['the', 0.1, 0.16],
    ['quick', 0.18, 0.28],
    ['brown', 0.3, 0.4],
    ['fox', 0.42, 0.48],
  ]),
  makeLine(1, 0.15, [
    ['jumps', 0.1, 0.2],
    ['over', 0.22, 0.3],
    ['the', 0.32, 0.38],
    ['lazy', 0.4, 0.48],
    ['dog', 0.5, 0.56],
  ]),
  makeLine(2, 0.2, [
    ['and', 0.1, 0.16],
    ['runs', 0.18, 0.26],
    ['away', 0.28, 0.38],
  ]),
];

function rounded(rs: NormRect[]): NormRect[] {
  const r = (n: number) => Math.round(n * 1e6) / 1e6;
  return rs.map((x) => ({ x0: r(x.x0), y0: r(x.y0), x1: r(x.x1), y1: r(x.y1) }));
}

describe('snapSelection', () => {
  test('empty line list → []', () => {
    expect(snapSelection([], pt(0, 0), pt(1, 1))).toEqual([]);
  });

  test('drag touching no line → []', () => {
    expect(snapSelection(PAGE, pt(0.1, 0.5), pt(0.9, 0.6))).toEqual([]);
  });

  test('single line, full drag → one rect spanning the line', () => {
    const rects = rounded(snapSelection(PAGE, pt(0.05, 0.11), pt(0.95, 0.12)));
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x0: 0.1, y0: 0.1, x1: 0.48, y1: 0.13 });
  });

  test('single word drag snaps to char boundaries inside the word', () => {
    // Drag inside "quick" (0.18–0.28, 5 chars): 0.20 → 0.26.
    const rects = rounded(snapSelection(PAGE, pt(0.2, 0.115), pt(0.26, 0.115)));
    expect(rects).toHaveLength(1);
    const [r] = rects;
    // char-snapped: 1 char in (0.20), 4 chars in (0.26) of a 5-char word.
    expect(r.x0).toBeCloseTo(0.18 + 0.1 * (1 / 5), 6);
    expect(r.x1).toBeCloseTo(0.18 + 0.1 * (4 / 5), 6);
    expect(r.x0).toBeGreaterThanOrEqual(0.18);
    expect(r.x1).toBeLessThanOrEqual(0.28);
  });

  test('multi-line drag → partial first/last, full middle', () => {
    // Anchor mid-line-0 (x=0.35, inside "brown"), active mid-line-2 (x=0.2).
    const rects = rounded(
      snapSelection(PAGE, pt(0.35, 0.11), pt(0.2, 0.21)),
    );
    expect(rects).toHaveLength(3);
    // First line: from char-snapped 0.35 to end of line (0.48).
    expect(rects[0].y0).toBe(0.1);
    expect(rects[0].x1).toBe(0.48);
    expect(rects[0].x0).toBeGreaterThan(0.3); // inside "brown" (0.30–0.40)
    expect(rects[0].x0).toBeLessThan(0.4);
    // Middle line: full line rect.
    expect(rects[1]).toEqual({ x0: 0.1, y0: 0.15, x1: 0.56, y1: 0.18 });
    // Last line: from line start to char-snapped 0.2.
    expect(rects[2]).toEqual({
      x0: 0.1,
      y0: 0.2,
      x1: rects[2].x1,
      y1: 0.23,
    });
    expect(rects[2].x1).toBeGreaterThan(0.18);
    expect(rects[2].x1).toBeLessThanOrEqual(0.26);
  });

  test('backwards drag (active above anchor) → same rects as forward drag', () => {
    const fwd = rounded(snapSelection(PAGE, pt(0.35, 0.11), pt(0.2, 0.21)));
    const bwd = rounded(snapSelection(PAGE, pt(0.2, 0.21), pt(0.35, 0.11)));
    expect(bwd).toEqual(fwd);
  });

  test('two-line drag, reversed x order still normalized', () => {
    const rects = snapSelection(PAGE, pt(0.9, 0.16), pt(0.05, 0.11));
    expect(rects).toHaveLength(2);
    // Reading order: line 0 first.
    expect(rects[0].y0).toBe(0.1);
    expect(rects[1].y0).toBe(0.15);
    for (const r of rects) expect(r.x1).toBeGreaterThan(r.x0);
  });

  test('anchor beyond line end clamps to line end', () => {
    const rects = rounded(snapSelection(PAGE, pt(0.99, 0.11), pt(0.99, 0.11)));
    // Zero-width selection → no rect.
    expect(rects).toEqual([]);
  });

  test('lines given out of order are sorted internally', () => {
    const shuffled = [PAGE[2], PAGE[0], PAGE[1]];
    const a = rounded(snapSelection(PAGE, pt(0.35, 0.11), pt(0.2, 0.21)));
    const b = rounded(snapSelection(shuffled, pt(0.35, 0.11), pt(0.2, 0.21)));
    expect(b).toEqual(a);
  });
});
