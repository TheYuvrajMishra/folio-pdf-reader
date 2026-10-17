/**
 * turnPolicy.test.ts — unit tests for the pure page-turn policy.
 *
 * Covers the commit/cancel threshold matrix (PRD §6.3: >35% progress or
 * fling > 800 px/s commits), the spring/drive config mapping, the p95 helper,
 * and the auto-downgrade predicate.
 */

import {
  COMMIT_PROGRESS_THRESHOLD,
  COMMIT_VELOCITY_PX_S,
  DOWNGRADE_CONSECUTIVE_TURNS,
  FRAME_P95_DOWNGRADE_MS,
  TURN_SETTLE_SPRING,
  decideTurnEnd,
  p95,
  shouldDowngrade,
  turnDriveForStyle,
} from '../turnPolicy';

describe('threshold constants (PRD §6.3, DESIGN.md §7)', () => {
  test('commit threshold is 35%', () => {
    expect(COMMIT_PROGRESS_THRESHOLD).toBe(0.35);
  });

  test('fling threshold is 800 px/s', () => {
    expect(COMMIT_VELOCITY_PX_S).toBe(800);
  });

  test('curl settle spring matches the design spec', () => {
    expect(TURN_SETTLE_SPRING).toEqual({ damping: 20, stiffness: 180, mass: 1 });
  });

  test('downgrade triggers above 24 ms p95 for 3 consecutive turns', () => {
    expect(FRAME_P95_DOWNGRADE_MS).toBe(24);
    expect(DOWNGRADE_CONSECUTIVE_TURNS).toBe(3);
  });
});

describe('decideTurnEnd — progress/velocity matrix', () => {
  // [progress, velocityInTurnDirectionPxS, expected]
  const cases: Array<[number, number, 'commit' | 'cancel']> = [
    [0.0, 0, 'cancel'],
    [0.2, 100, 'cancel'],
    [0.34, 799, 'cancel'],
    [0.35, 0, 'cancel'], // strictly greater than 35%
    [0.350001, 0, 'commit'],
    [0.5, 0, 'commit'],
    [1.0, 0, 'commit'],
    [0.0, 800, 'cancel'], // strictly greater than 800
    [0.0, 800.1, 'commit'],
    [0.05, 1200, 'commit'], // fling commits from almost rest
    [0.2, -500, 'cancel'], // wrong-way velocity never commits
    [0.9, -2000, 'commit'], // high progress commits despite wrong-way fling
  ];
  test.each(cases)(
    'progress=%p velocity=%p → %s',
    (progress, velocity, expected) => {
      expect(decideTurnEnd(progress, velocity)).toBe(expected);
    },
  );
});

describe('p95', () => {
  test('empty input → 0', () => {
    expect(p95([])).toBe(0);
  });

  test('single sample → that sample', () => {
    expect(p95([16.7])).toBe(16.7);
  });

  test('picks the 95th percentile', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(p95(samples)).toBe(95);
  });

  test('small samples round up to the max', () => {
    expect(p95([10, 20, 30])).toBe(30);
  });
});

describe('shouldDowngrade', () => {
  test('fewer than 3 turns → false', () => {
    expect(shouldDowngrade([])).toBe(false);
    expect(shouldDowngrade([30])).toBe(false);
    expect(shouldDowngrade([30, 31])).toBe(false);
  });

  test('3 consecutive janky turns → true', () => {
    expect(shouldDowngrade([25, 30, 41])).toBe(true);
  });

  test('one fast turn in the window → false', () => {
    expect(shouldDowngrade([25, 16, 41])).toBe(false);
    expect(shouldDowngrade([16, 30, 41])).toBe(false);
  });

  test('only the last 3 turns count', () => {
    expect(shouldDowngrade([99, 99, 25, 30, 41])).toBe(true);
    expect(shouldDowngrade([25, 30, 41, 10])).toBe(false);
  });

  test('boundary is strict: exactly 24 ms is not janky', () => {
    expect(shouldDowngrade([24, 24, 24])).toBe(false);
    expect(shouldDowngrade([24.001, 24.001, 24.001])).toBe(true);
  });
});

describe('turnDriveForStyle — spring/timing mapping', () => {
  test('curl → spring with the design-spec config', () => {
    expect(turnDriveForStyle('curl', false)).toEqual({
      kind: 'spring',
      damping: 20,
      stiffness: 180,
      mass: 1,
    });
  });

  test('slide → 280 ms timing', () => {
    expect(turnDriveForStyle('slide', false)).toEqual({
      kind: 'timing',
      durationMs: 280,
    });
  });

  test('fade → 180 ms timing', () => {
    expect(turnDriveForStyle('fade', false)).toEqual({
      kind: 'timing',
      durationMs: 180,
    });
  });

  test('none → instant', () => {
    expect(turnDriveForStyle('none', false)).toEqual({ kind: 'instant' });
  });

  test.each(['curl', 'slide', 'fade', 'none'] as const)(
    'reduced motion forces the 120 ms fade for %s',
    (style) => {
      expect(turnDriveForStyle(style, true)).toEqual({
        kind: 'timing',
        durationMs: 120,
      });
    },
  );

  test('corrupt style value degrades to a fade, never crashes', () => {
    expect(
      turnDriveForStyle('glitch' as 'curl', false),
    ).toEqual({ kind: 'timing', durationMs: 180 });
  });
});
