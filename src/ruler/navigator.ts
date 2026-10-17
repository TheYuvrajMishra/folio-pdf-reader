/**
 * navigator.ts — pure reading-ruler step logic (PRD §6.5).
 *
 * Lines come from the page's line index, sorted top→bottom. This module is
 * deliberately UI- and page-turn-free: it only decides the next step, and the
 * caller (ruler store) performs page turns when a {type:'page'} step arrives.
 *
 * Platform-free: no react-native imports.
 */

import type { Line } from '../engine/lines';

export type StepResult =
  /** Move the ruler to a line on the current page. */
  | { type: 'line'; idx: number }
  /** Cross a page boundary; caller turns the page then places the ruler on
   * the first/last line of the new page. */
  | { type: 'page'; delta: 1 | -1; edge: 'first' | 'last' }
  /** No steppable lines on this page (blank/figure-only, or every line
   * filtered out). UI shows "no text — tap ▼ to skip page". */
  | { type: 'empty' };

export interface StepOptions {
  /**
   * Skip kind:'margin' lines (headers/footers/page numbers) while stepping.
   * When this filters out every line, the result is {type:'empty'}.
   */
  skipMargins?: boolean;
}

/**
 * Step the ruler one line in `dir` from `currentIdx`.
 *
 * - ▼ (dir=1) on the last steppable line → {type:'page', delta:1, edge:'first'}
 * - ▲ (dir=-1) on the first steppable line → {type:'page', delta:-1, edge:'last'}
 * - Empty line list → {type:'empty'}
 *
 * When `currentIdx` is not itself steppable (e.g. the ruler sits on a margin
 * line while skipMargins is on), stepping moves to the nearest steppable
 * line in `dir`, or across the page boundary if none exists in that
 * direction.
 */
export function stepLine(
  lines: Line[],
  currentIdx: number,
  dir: 1 | -1,
  opts: StepOptions = {},
): StepResult {
  if (dir !== 1 && dir !== -1) {
    throw new Error(
      `ruler.stepLine: dir must be 1 or -1, got ${String(dir)}`,
    );
  }
  const ordered = [...lines].sort((a, b) => a.idx - b.idx);
  const cands =
    opts.skipMargins === true
      ? ordered.filter((l) => l.kind !== 'margin')
      : ordered;
  if (cands.length === 0) return { type: 'empty' };

  const pos = cands.findIndex((l) => l.idx === currentIdx);
  if (pos === -1) {
    // Current line isn't steppable: move to the nearest candidate in dir.
    if (dir === 1) {
      const next = cands.find((l) => l.idx > currentIdx);
      return next
        ? { type: 'line', idx: next.idx }
        : { type: 'page', delta: 1, edge: 'first' };
    }
    const prev = [...cands].reverse().find((l) => l.idx < currentIdx);
    return prev
      ? { type: 'line', idx: prev.idx }
      : { type: 'page', delta: -1, edge: 'last' };
  }

  if (dir === 1) {
    return pos + 1 < cands.length
      ? { type: 'line', idx: cands[pos + 1].idx }
      : { type: 'page', delta: 1, edge: 'first' };
  }
  return pos - 1 >= 0
    ? { type: 'line', idx: cands[pos - 1].idx }
    : { type: 'page', delta: -1, edge: 'last' };
}

/** Convenience: index of the first steppable line, or null when none. */
export function firstSteppable(lines: Line[], skipMargins = false): number | null {
  const cands = skipMargins ? lines.filter((l) => l.kind !== 'margin') : lines;
  if (cands.length === 0) return null;
  return Math.min(...cands.map((l) => l.idx));
}

/** Convenience: index of the last steppable line, or null when none. */
export function lastSteppable(lines: Line[], skipMargins = false): number | null {
  const cands = skipMargins ? lines.filter((l) => l.kind !== 'margin') : lines;
  if (cands.length === 0) return null;
  return Math.max(...cands.map((l) => l.idx));
}
