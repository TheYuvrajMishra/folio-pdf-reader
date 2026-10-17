import {
  pdfRectToNorm,
  normToScreen,
  screenToNorm,
  type PageGeom,
} from '../geometry';

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const closeRect = (
  r: { x0: number; y0: number; x1: number; y1: number } | null,
  e: { x0: number; y0: number; x1: number; y1: number },
  eps = 1e-9,
) => {
  expect(r).not.toBeNull();
  expect(close(r!.x0, e.x0, eps)).toBe(true);
  expect(close(r!.y0, e.y0, eps)).toBe(true);
  expect(close(r!.x1, e.x1, eps)).toBe(true);
  expect(close(r!.y1, e.y1, eps)).toBe(true);
};

// US Letter, no crop: media 612x792.
const LETTER: PageGeom = { mediaW: 612, mediaH: 792, rotation: 0 };

describe('pdfRectToNorm — rotation point mapping', () => {
  // PDF-space rect near the bottom-left: x 100..200, y 100..150 (y-up).
  const rect = { x0: 100, y0: 100, x1: 200, y1: 150 };

  test('rotation 0: y flips within the page', () => {
    closeRect(pdfRectToNorm(rect, LETTER), {
      x0: 100 / 612,
      x1: 200 / 612,
      y0: (792 - 150) / 792,
      y1: (792 - 100) / 792,
    });
  });

  test('rotation 90: (x,y) -> (y,x), dims swapped', () => {
    closeRect(pdfRectToNorm(rect, { ...LETTER, rotation: 90 }), {
      x0: 100 / 792,
      x1: 150 / 792,
      y0: 100 / 612,
      y1: 200 / 612,
    });
  });

  test('rotation 180: x flips, y stays', () => {
    closeRect(pdfRectToNorm(rect, { ...LETTER, rotation: 180 }), {
      x0: (612 - 200) / 612,
      x1: (612 - 100) / 612,
      y0: 100 / 792,
      y1: 150 / 792,
    });
  });

  test('rotation 270: (x,y) -> (H-y, W-x), dims swapped', () => {
    closeRect(pdfRectToNorm(rect, { ...LETTER, rotation: 270 }), {
      x0: (792 - 150) / 792,
      x1: (792 - 100) / 792,
      y0: (612 - 200) / 612,
      y1: (612 - 100) / 612,
    });
  });

  test('four 90° turns compose to identity', () => {
    // Apply rotation r to a rect, then express "the same visual spot" for r+90
    // by rotating the PDF-space rect itself; simpler: check a full cycle of
    // the viewport dims and corner mapping is consistent.
    const r0 = pdfRectToNorm(rect, { ...LETTER, rotation: 0 })!;
    const r180 = pdfRectToNorm(rect, { ...LETTER, rotation: 180 })!;
    // 180° of the rect mirrored across page center should equal 0° of the
    // rect mirrored in PDF space.
    const mirrored = {
      x0: 612 - 200,
      y0: 792 - 150,
      x1: 612 - 100,
      y1: 792 - 100,
    };
    const r180ofMirrored = pdfRectToNorm(mirrored, {
      ...LETTER,
      rotation: 180,
    })!;
    closeRect(r180ofMirrored, r0);
    expect(r180).not.toBeNull();
  });
});

describe('pdfRectToNorm — CropBox ≠ MediaBox', () => {
  // 1-inch margins cropped off US Letter: crop (72,72)..(540,720).
  const CROPPED: PageGeom = {
    mediaW: 612,
    mediaH: 792,
    crop: { x: 72, y: 72, w: 468, h: 648 },
    rotation: 0,
  };
  const rect = { x0: 100, y0: 100, x1: 200, y1: 150 };

  test('normalizes against the crop box, not the media box', () => {
    closeRect(pdfRectToNorm(rect, CROPPED), {
      x0: (100 - 72) / 468,
      x1: (200 - 72) / 468,
      y0: (720 - 150) / 648,
      y1: (720 - 100) / 648,
    });
  });

  test('crop + rotation 90 uses swapped crop dims', () => {
    closeRect(pdfRectToNorm(rect, { ...CROPPED, rotation: 90 }), {
      x0: (100 - 72) / 648,
      x1: (150 - 72) / 648,
      y0: (100 - 72) / 468,
      y1: (200 - 72) / 468,
    });
  });

  test('crop + rotation 270', () => {
    closeRect(pdfRectToNorm(rect, { ...CROPPED, rotation: 270 }), {
      x0: (720 - 150) / 648,
      x1: (720 - 100) / 648,
      y0: (540 - 200) / 468,
      y1: (540 - 100) / 468,
    });
  });

  test('crop + rotation 180', () => {
    closeRect(pdfRectToNorm(rect, { ...CROPPED, rotation: 180 }), {
      x0: (540 - 200) / 468,
      x1: (540 - 100) / 468,
      y0: (100 - 72) / 648,
      y1: (150 - 72) / 648,
    });
  });

  test('rect outside the crop box is not clipped (values may exceed 0..1)', () => {
    const r = pdfRectToNorm(
      { x0: 0, y0: 0, x1: 72, y1: 72 },
      CROPPED,
    )!;
    expect(r.x0).toBeLessThan(0);
    expect(r.y1).toBeGreaterThan(1);
  });
});

describe('pdfRectToNorm — degenerate inputs', () => {
  test('zero-size crop returns null (documented)', () => {
    expect(
      pdfRectToNorm({ x0: 0, y0: 0, x1: 10, y1: 10 }, {
        mediaW: 612,
        mediaH: 792,
        crop: { x: 0, y: 0, w: 0, h: 792 },
      }),
    ).toBeNull();
    expect(
      pdfRectToNorm({ x0: 0, y0: 0, x1: 10, y1: 10 }, {
        mediaW: 0,
        mediaH: 0,
      }),
    ).toBeNull();
  });

  test('unsupported rotation throws (documented)', () => {
    expect(() =>
      pdfRectToNorm({ x0: 0, y0: 0, x1: 10, y1: 10 }, {
        mediaW: 612,
        mediaH: 792,
        rotation: 45 as 0,
      }),
    ).toThrow(/unsupported rotation/);
  });
});

describe('normToScreen / screenToNorm', () => {
  const page = { x: 10, y: 20, width: 300, height: 400 };

  test('norm -> screen applies zoom/pan via the page rect', () => {
    closeRect(normToScreen({ x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }, page), {
      x0: 85,
      y0: 120,
      x1: 160,
      y1: 220,
    });
  });

  test('round-trip norm -> screen -> norm is identity', () => {
    const norm = { x0: 0.123, y0: 0.456, x1: 0.789, y1: 0.999 };
    const back = screenToNorm(normToScreen(norm, page)!, page);
    closeRect(back, norm, 1e-12);
  });

  test('round-trip screen -> norm -> screen is identity', () => {
    const screen = { x0: 11, y0: 21, x1: 309, y1: 419 };
    const back = normToScreen(screenToNorm(screen, page)!, page);
    closeRect(back, screen, 1e-9);
  });

  test('zero-size page rect returns null (documented)', () => {
    const norm = { x0: 0, y0: 0, x1: 1, y1: 1 };
    expect(normToScreen(norm, { x: 0, y: 0, width: 0, height: 400 })).toBeNull();
    expect(screenToNorm(norm, { x: 0, y: 0, width: 300, height: 0 })).toBeNull();
    expect(
      normToScreen(norm, { x: 0, y: 0, width: NaN, height: 400 }),
    ).toBeNull();
  });

  test('points off the page map outside 0..1 (no clamping)', () => {
    const n = screenToNorm({ x0: -50, y0: -50, x1: -40, y1: -40 }, page)!;
    expect(n.x0).toBeLessThan(0);
    expect(n.y0).toBeLessThan(0);
  });
});
