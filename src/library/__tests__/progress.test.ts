import { formatProgressMeta, progressPercent } from '../progress';

describe('progressPercent', () => {
  test('124 of 612', () => {
    expect(progressPercent(124, 612)).toBeCloseTo(124 / 612, 10);
  });

  test('clamps to 0..1', () => {
    expect(progressPercent(700, 612)).toBe(1);
    expect(progressPercent(-5, 612)).toBe(0);
  });

  test('unknown page or total → 0', () => {
    expect(progressPercent(null, 612)).toBe(0);
    expect(progressPercent(10, null)).toBe(0);
    expect(progressPercent(10, 0)).toBe(0);
    expect(progressPercent(undefined, undefined)).toBe(0);
  });
});

describe('formatProgressMeta', () => {
  test('DESIGN §6.1 hero format', () => {
    expect(formatProgressMeta(124, 612)).toBe('p.124 / 612 · 20%');
  });

  test('rounds the percent', () => {
    expect(formatProgressMeta(1, 3)).toBe('p.1 / 3 · 33%');
  });

  test('falls back without position or total', () => {
    expect(formatProgressMeta(null, 612)).toBe('p.1 / 612 · 0%');
    expect(formatProgressMeta(5, null)).toBe('p.5');
  });
});
