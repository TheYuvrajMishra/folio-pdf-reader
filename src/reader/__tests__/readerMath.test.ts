/**
 * readerMath.test.ts — platform-free tests for the reader geometry helpers.
 */
import {
  classifyTapZone,
  clampZoom,
  doubleTapZoomTarget,
  pageToX,
  pickRasterScale,
  prefetchWindow,
  xToPage,
  DOUBLE_TAP_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
} from '../readerMath';

describe('pickRasterScale', () => {
  it('caps at 2x for wide screens', () => {
    // 1080px screen, US-letter-ish 612pt page → 1.764
    expect(pickRasterScale(612, 1080)).toBeCloseTo(1.7647, 4);
  });

  it('caps at MAX_RASTER_SCALE even when the ratio is larger', () => {
    expect(pickRasterScale(300, 3000)).toBe(2);
  });

  it('returns a fractional scale for narrow screens', () => {
    expect(pickRasterScale(612, 400)).toBeCloseTo(0.6536, 4);
  });

  it('returns 1 for degenerate input', () => {
    expect(pickRasterScale(0, 1080)).toBe(1);
    expect(pickRasterScale(612, 0)).toBe(1);
    expect(pickRasterScale(-5, 1080)).toBe(1);
    expect(pickRasterScale(NaN, 1080)).toBe(1);
  });
});

describe('classifyTapZone', () => {
  const W = 1000;
  it('left 30% → prev', () => {
    expect(classifyTapZone(0, W)).toBe('prev');
    expect(classifyTapZone(299, W)).toBe('prev');
  });
  it('right 30% → next', () => {
    expect(classifyTapZone(700, W)).toBe('next');
    expect(classifyTapZone(999, W)).toBe('next');
  });
  it('center 40% → chrome', () => {
    expect(classifyTapZone(300, W)).toBe('chrome');
    expect(classifyTapZone(500, W)).toBe('chrome');
    expect(classifyTapZone(699, W)).toBe('chrome');
  });
  it('degenerate width → chrome', () => {
    expect(classifyTapZone(50, 0)).toBe('chrome');
  });
});

describe('clampZoom / doubleTapZoomTarget', () => {
  it('clamps to 1–5x', () => {
    expect(clampZoom(0.5)).toBe(MIN_ZOOM);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(NaN)).toBe(MIN_ZOOM);
  });
  it('double-tap toggles fit ↔ 2.5x', () => {
    expect(doubleTapZoomTarget(1)).toBe(DOUBLE_TAP_ZOOM);
    expect(doubleTapZoomTarget(1.2)).toBe(DOUBLE_TAP_ZOOM);
    expect(doubleTapZoomTarget(1.3)).toBe(MIN_ZOOM);
    expect(doubleTapZoomTarget(2.5)).toBe(MIN_ZOOM);
  });
});

describe('scrubber page mapping', () => {
  const TRACK = 360;
  const COUNT = 412;

  it('maps track ends to first/last page', () => {
    expect(xToPage(0, TRACK, COUNT)).toBe(1);
    expect(xToPage(TRACK, TRACK, COUNT)).toBe(COUNT);
  });

  it('maps the middle to the middle page', () => {
    expect(xToPage(TRACK / 2, TRACK, COUNT)).toBe(207); // 1 + 0.5*411 = 206.5 → 207
  });

  it('clamps out-of-range drags', () => {
    expect(xToPage(-50, TRACK, COUNT)).toBe(1);
    expect(xToPage(TRACK + 50, TRACK, COUNT)).toBe(COUNT);
  });

  it('round-trips page → x → page', () => {
    for (const p of [1, 2, 50, 124, 411, 412]) {
      expect(xToPage(pageToX(p, TRACK, COUNT), TRACK, COUNT)).toBe(p);
    }
  });

  it('degenerates gracefully for a single page', () => {
    expect(xToPage(100, TRACK, 1)).toBe(1);
    expect(pageToX(1, TRACK, 1)).toBe(0);
  });

  it('degenerates gracefully for a zero-width track', () => {
    expect(xToPage(10, 0, COUNT)).toBe(1);
    expect(pageToX(10, 0, COUNT)).toBe(0);
  });
});

describe('prefetchWindow', () => {
  it('returns ±2 pages around the current page', () => {
    expect(prefetchWindow(5, 10)).toEqual([3, 4, 6, 7]);
  });

  it('clips at the start', () => {
    expect(prefetchWindow(1, 10)).toEqual([2, 3]);
    expect(prefetchWindow(2, 10)).toEqual([1, 3, 4]);
  });

  it('clips at the end', () => {
    expect(prefetchWindow(10, 10)).toEqual([8, 9]);
    expect(prefetchWindow(9, 10)).toEqual([7, 8, 10]);
  });

  it('returns [] for a single-page book', () => {
    expect(prefetchWindow(1, 1)).toEqual([]);
  });

  it('never includes the current page', () => {
    for (let p = 1; p <= 6; p += 1) {
      expect(prefetchWindow(p, 6)).not.toContain(p);
    }
  });

  it('supports a custom radius', () => {
    expect(prefetchWindow(5, 10, 1)).toEqual([4, 6]);
  });
});
