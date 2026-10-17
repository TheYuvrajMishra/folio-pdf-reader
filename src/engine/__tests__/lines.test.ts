import { extractLines, type TextItem } from '../lines';
import type { PageGeom } from '../../util/geometry';

const LETTER: PageGeom = { mediaW: 612, mediaH: 792, rotation: 0 };

const item = (
  str: string,
  e: number,
  f: number,
  w: number,
  h: number,
): TextItem => ({
  str,
  transform: [1, 0, 0, 1, e, f],
  width: w,
  height: h,
});

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('extractLines — basic clustering', () => {
  test('two y-bands become two lines; items sorted by y0 then x0', () => {
    const lines = extractLines(
      [
        item('Next line', 72, 670, 80, 12),
        item('world', 130, 700, 50, 12),
        item('Hello', 72, 700, 50, 12),
      ],
      LETTER,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0].idx).toBe(0);
    expect(lines[0].text).toBe('Hello world');
    expect(lines[1].idx).toBe(1);
    expect(lines[1].text).toBe('Next line');
    // Top band: PDF y 700..712 -> viewport y (792-712)/792 .. (792-700)/792.
    expect(close(lines[0].box.x0, 72 / 612)).toBe(true);
    expect(close(lines[0].box.x1, 180 / 612)).toBe(true);
    expect(close(lines[0].box.y0, 80 / 792)).toBe(true);
    expect(close(lines[0].box.y1, 92 / 792)).toBe(true);
    expect(lines[0].kind).toBe('body');
  });

  test('overlapping fragments on one band merge into a single line', () => {
    const lines = extractLines(
      [
        item('frag', 72, 640, 100, 12),
        item('ment', 150, 640, 100, 12),
      ],
      LETTER,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('frag ment');
    expect(close(lines[0].box.x0, 72 / 612)).toBe(true);
    expect(close(lines[0].box.x1, 250 / 612)).toBe(true);
  });
});

describe('extractLines — rotation', () => {
  test('rotated page: PDF column becomes a viewport row, still one line', () => {
    const geom: PageGeom = { ...LETTER, rotation: 90 };
    const lines = extractLines(
      [
        item('alpha', 300, 700, 12, 10),
        item('beta', 300, 680, 12, 10),
        item('gamma', 300, 660, 12, 10),
      ],
      geom,
    );
    expect(lines).toHaveLength(1);
    // Viewport: vx = pdf-y, vy = pdf-x. Ordered by vx ascending.
    expect(lines[0].text).toBe('gamma beta alpha');
    expect(close(lines[0].box.x0, 660 / 792)).toBe(true);
    expect(close(lines[0].box.x1, 710 / 792)).toBe(true);
    expect(close(lines[0].box.y0, 300 / 612)).toBe(true);
    expect(close(lines[0].box.y1, 312 / 612)).toBe(true);
    // All boxes stay inside 0..1.
    for (const l of lines) {
      expect(l.box.x0).toBeGreaterThanOrEqual(0);
      expect(l.box.x1).toBeLessThanOrEqual(1);
      expect(l.box.y0).toBeGreaterThanOrEqual(0);
      expect(l.box.y1).toBeLessThanOrEqual(1);
    }
  });
});

describe('extractLines — filtering', () => {
  test('tiny artifacts (height < 0.4 × median) are dropped', () => {
    const lines = extractLines(
      [
        item('line one', 72, 700, 100, 12),
        item('line two', 72, 670, 100, 12),
        item('line three', 72, 640, 100, 12),
        item('line four', 72, 610, 100, 12),
        item('•', 72, 580, 30, 2), // tiny artifact, own band
      ],
      LETTER,
    );
    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.text)).toEqual([
      'line one',
      'line two',
      'line three',
      'line four',
    ]);
  });

  test('empty / whitespace-only lines are dropped', () => {
    const lines = extractLines(
      [
        item('real text', 72, 700, 100, 12),
        item('   ', 72, 670, 40, 12),
        item('', 72, 640, 0, 12),
      ],
      LETTER,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('real text');
  });

  test('no items → no lines', () => {
    expect(extractLines([], LETTER)).toEqual([]);
  });
});

describe('extractLines — margin flagging', () => {
  test('lines centered in top/bottom 6% are kind:margin', () => {
    const lines = extractLines(
      [
        item('Header', 72, 770, 100, 12), // viewport center ≈ 0.020
        item('Body text here', 72, 400, 120, 12), // center ≈ 0.487
        item('Page 1', 72, 20, 60, 12), // viewport center ≈ 0.967
      ],
      LETTER,
    );
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.kind)).toEqual(['margin', 'body', 'margin']);
  });
});

describe('extractLines — word boxes', () => {
  test('word boxes of single-word tiling items sum to the line width', () => {
    const lines = extractLines(
      [
        item('aaa', 0, 700, 100, 12),
        item('bbb', 100, 700, 100, 12),
      ],
      LETTER,
    );
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.words.map((w) => w.text)).toEqual(['aaa', 'bbb']);
    const sumW = line.words.reduce(
      (s, w) => s + (w.box.x1 - w.box.x0),
      0,
    );
    const lineW = line.box.x1 - line.box.x0;
    expect(Math.abs(sumW - lineW)).toBeLessThan(1e-9);
    // Words are x-sorted, non-overlapping, inside the line box.
    expect(line.words[0].box.x1).toBeLessThanOrEqual(line.words[1].box.x0 + 1e-9);
    for (const w of line.words) {
      expect(w.box.x0).toBeGreaterThanOrEqual(line.box.x0 - 1e-9);
      expect(w.box.x1).toBeLessThanOrEqual(line.box.x1 + 1e-9);
      expect(w.box.y0).toBeGreaterThanOrEqual(line.box.y0 - 1e-9);
      expect(w.box.y1).toBeLessThanOrEqual(line.box.y1 + 1e-9);
    }
  });

  test('multi-word item: words split proportionally by char count', () => {
    const lines = extractLines([item('Hello world', 0, 670, 110, 12)], LETTER);
    expect(lines).toHaveLength(1);
    const [w1, w2] = lines[0].words;
    expect(w1.text).toBe('Hello');
    expect(w2.text).toBe('world');
    // 5/11 of 110pt each = 50pt; 10pt gap between them.
    expect(close(w1.box.x1 - w1.box.x0, 50 / 612)).toBe(true);
    expect(close(w2.box.x0 - w1.box.x1, 10 / 612)).toBe(true);
    expect(close(w2.box.x1, 110 / 612)).toBe(true);
  });
});
