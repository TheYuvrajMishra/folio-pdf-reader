/**
 * outline.test.ts — best-effort outline destination → page resolution (M5).
 *
 * The engine serializes pdf.js dests as JSON. `resolveOutlinePage` is pure
 * and lives in ContentsSheet.tsx.
 */

import { resolveOutlinePage } from '../outline';

describe('resolveOutlinePage', () => {
  test('null / empty destJson → null (disabled row)', () => {
    expect(resolveOutlinePage(null)).toBeNull();
    expect(resolveOutlinePage('')).toBeNull();
  });

  test('0-based page index resolves to 1-based page', () => {
    expect(resolveOutlinePage('4')).toBe(5);
    expect(resolveOutlinePage('[12,"XYZ",0,0,0]')).toBe(13);
  });

  test('named destinations and page refs → null', () => {
    expect(resolveOutlinePage('"chapter-3"')).toBeNull();
    expect(resolveOutlinePage('[{"num":5,"gen":0},{"name":"XYZ"}]')).toBeNull();
  });

  test('garbage JSON → null', () => {
    expect(resolveOutlinePage('not json')).toBeNull();
    expect(resolveOutlinePage('[1,')).toBeNull();
  });

  test('negative / non-integer indices → null', () => {
    expect(resolveOutlinePage('-1')).toBeNull();
    expect(resolveOutlinePage('2.5')).toBeNull();
  });
});
