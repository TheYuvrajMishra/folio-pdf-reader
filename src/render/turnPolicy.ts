/**
 * turnPolicy.ts — pure page-turn policy (PRD §6.3, DESIGN.md §7).
 *
 * Framework-free math + constants shared by the gesture state machine
 * (`usePageTurn`) and the unit tests. Every function is marked with the
 * 'worklet' directive (repo convention, see `src/reader/readerMath.ts`) so it
 * can also be called from Reanimated UI-thread worklets — verified that the
 * Reanimated 4 worklets babel plugin serializes plain module functions into
 * worklet closures.
 *
 * Sources of truth:
 * - commit rule: progress > 35% OR fling > 800 px/s in the turn direction
 * - curl settle spring: { damping: 20, stiffness: 180, mass: 1 } (≈420 ms)
 * - slide: 280 ms (bezier easing applied inside `slideFrameAt`)
 * - fade: 180 ms linear; reduced motion: 120 ms fade regardless of style
 * - auto-downgrade: curl → slide when frame-time p95 > 24 ms for 3 turns
 */

import { FADE_DURATION_MS, REDUCED_MOTION_FADE_MS } from './fade';
import { SLIDE_DURATION_MS } from './slide';
import type { PageAnimationStyle } from '../data/settings';

/** Commit threshold on finger-driven progress (PRD §6.3). */
export const COMMIT_PROGRESS_THRESHOLD = 0.35;

/** Fling velocity in the turn direction (px/s) that commits regardless of progress. */
export const COMMIT_VELOCITY_PX_S = 800;

/** Curl release/settle spring (DESIGN.md §7). */
export const TURN_SETTLE_SPRING = { damping: 20, stiffness: 180, mass: 1 } as const;

/** Frame-time p95 (ms) above which a curl turn counts as janky (PRD §6.3). */
export const FRAME_P95_DOWNGRADE_MS = 24;

/** Consecutive janky turns before the auto-downgrade fires. */
export const DOWNGRADE_CONSECUTIVE_TURNS = 3;

export type TurnDecision = 'commit' | 'cancel';

/**
 * Commit-vs-cancel decision on gesture release.
 * @param progress finger-driven progress 0..1 (via `curlProgressFromDrag`).
 * @param velocityInTurnDirectionPxS signed velocity along the turn direction
 *        (positive = moving toward the next page); fling > 800 commits.
 */
export function decideTurnEnd(
  progress: number,
  velocityInTurnDirectionPxS: number,
): TurnDecision {
  'worklet';
  if (
    progress > COMMIT_PROGRESS_THRESHOLD ||
    velocityInTurnDirectionPxS > COMMIT_VELOCITY_PX_S
  ) {
    return 'commit';
  }
  return 'cancel';
}

/** 95th percentile of a sample list (0 for empty). Worklet-safe. */
export function p95(values: readonly number[]): number {
  'worklet';
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[idx];
}

/**
 * Auto-downgrade predicate: true when the last DOWNGRADE_CONSECUTIVE_TURNS
 * turns were ALL janky (per-turn p95 frame time > FRAME_P95_DOWNGRADE_MS).
 * The caller additionally gates on style === 'curl' before downgrading.
 */
export function shouldDowngrade(recentP95s: readonly number[]): boolean {
  'worklet';
  if (recentP95s.length < DOWNGRADE_CONSECUTIVE_TURNS) {
    return false;
  }
  const tail = recentP95s.slice(-DOWNGRADE_CONSECUTIVE_TURNS);
  return tail.every((p) => p > FRAME_P95_DOWNGRADE_MS);
}

export type TurnDrive =
  | { kind: 'spring'; damping: number; stiffness: number; mass: number }
  | { kind: 'timing'; durationMs: number }
  | { kind: 'instant' };

/**
 * How `progress` is driven 0→1 (commit) or →0 (cancel) for a given style.
 * Slide/fade use linear timing — the bezier easing lives inside
 * `slideFrameAt`, and fade is linear by spec. Reduced motion forces the
 * 120 ms fade regardless of style (DESIGN.md §7).
 */
export function turnDriveForStyle(
  style: PageAnimationStyle,
  reducedMotion: boolean,
): TurnDrive {
  'worklet';
  if (reducedMotion) {
    return { kind: 'timing', durationMs: REDUCED_MOTION_FADE_MS };
  }
  switch (style) {
    case 'curl':
      return { kind: 'spring', ...TURN_SETTLE_SPRING };
    case 'slide':
      return { kind: 'timing', durationMs: SLIDE_DURATION_MS };
    case 'fade':
      return { kind: 'timing', durationMs: FADE_DURATION_MS };
    case 'none':
      return { kind: 'instant' };
    default:
      // Corrupt setting value: degrade to a cheap fade, never crash.
      return { kind: 'timing', durationMs: FADE_DURATION_MS };
  }
}
