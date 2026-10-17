import type { PageRectOnScreen } from '../../util/geometry';
import type { Annotation } from '../store';
import {
  bookmarkRibbon,
  noteAnchorToScreen,
  polylineToScreen,
  rectsToScreen,
  toScreenFromPageRect,
  unionScreenRect,
} from '../renderLayout';

const PAGE: PageRectOnScreen = { x: 10, y: 20, width: 100, height: 200 };
const toScreen = toScreenFromPageRect(PAGE);

const base: Annotation = {
  id: 'a1',
  book_id: 'b1',
  page: 3,
  type: 'highlight',
  color: '#FFD60A',
  opacity: 1,
  dataJson: {
    rects: [
      { x0: 0.1, y0: 0.2, x1: 0.4, y1: 0.25 },
      { x0: 0.1, y0: 0.26, x1: 0.3, y1: 0.31 },
    ],
  },
  note: null,
  created_at: 0,
  updated_at: 0,
  deleted: 0,
};

describe('toScreenFromPageRect', () => {
  test('maps the full page to the on-screen rect', () => {
    expect(toScreen({ x0: 0, y0: 0, x1: 1, y1: 1 })).toEqual({
      x0: 10,
      y0: 20,
      x1: 110,
      y1: 220,
    });
  });

  test('degenerate page rect → null', () => {
    const bad = toScreenFromPageRect({ x: 0, y: 0, width: 0, height: 100 });
    expect(bad({ x0: 0, y0: 0, x1: 1, y1: 1 })).toBeNull();
  });
});

describe('rectsToScreen', () => {
  test('maps each rect', () => {
    expect(rectsToScreen(base, toScreen)).toEqual([
      { x0: 20, y0: 60, x1: 50, y1: 70 },
      { x0: 20, y0: 72, x1: 40, y1: 82 },
    ]);
  });

  test('missing rects → []', () => {
    expect(
      rectsToScreen({ ...base, dataJson: {} }, toScreen),
    ).toEqual([]);
  });
});

describe('polylineToScreen', () => {
  test('maps each point', () => {
    const a: Annotation = {
      ...base,
      type: 'pen',
      dataJson: {
        polyline: [
          { x: 0, y: 0 },
          { x: 0.5, y: 1 },
        ],
      },
    };
    expect(polylineToScreen(a, toScreen)).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 220 },
    ]);
  });
});

describe('noteAnchorToScreen', () => {
  test('maps the anchor', () => {
    const a: Annotation = {
      ...base,
      type: 'note',
      dataJson: { noteAnchor: { x: 0.25, y: 0.5 } },
    };
    expect(noteAnchorToScreen(a, toScreen)).toEqual({ x: 35, y: 120 });
  });

  test('no anchor → null', () => {
    expect(noteAnchorToScreen(base, toScreen)).toBeNull();
  });
});

describe('bookmarkRibbon', () => {
  test('triangle at the top-right page corner', () => {
    const ribbon = bookmarkRibbon(toScreen);
    expect(ribbon).not.toBeNull();
    const leg = Math.min(100, 200) * 0.09; // 9
    expect(ribbon).toEqual([
      { x: 110 - leg, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 20 + leg },
    ]);
  });

  test('degenerate page → null', () => {
    const bad = toScreenFromPageRect({ x: 0, y: 0, width: 0, height: 0 });
    expect(bookmarkRibbon(bad)).toBeNull();
  });
});

describe('unionScreenRect', () => {
  test('bounding box of several rects', () => {
    expect(
      unionScreenRect([
        { x0: 20, y0: 60, x1: 50, y1: 70 },
        { x0: 20, y0: 72, x1: 40, y1: 82 },
      ]),
    ).toEqual({ x0: 20, y0: 60, x1: 50, y1: 82 });
  });

  test('empty → null', () => {
    expect(unionScreenRect([])).toBeNull();
  });
});
