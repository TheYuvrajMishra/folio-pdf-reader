import {
  stepLine,
  firstSteppable,
  lastSteppable,
  type StepResult,
} from '../navigator';
import type { Line } from '../../engine/lines';

const mkLines = (kinds: Array<'body' | 'margin'>): Line[] =>
  kinds.map((kind, i) => ({
    idx: i,
    text: `line ${i}`,
    box: { x0: 0, y0: i / kinds.length, x1: 1, y1: (i + 1) / kinds.length },
    words: [],
    kind,
  }));

const bodies = (n: number): Line[] =>
  mkLines(Array.from({ length: n }, () => 'body' as const));

describe('stepLine — basic stepping', () => {
  test('mid-page ▼/▲ moves one line', () => {
    const lines = bodies(5);
    expect(stepLine(lines, 2, 1)).toEqual({ type: 'line', idx: 3 });
    expect(stepLine(lines, 2, -1)).toEqual({ type: 'line', idx: 1 });
  });

  test('▼ on last line → next page, first line', () => {
    expect(stepLine(bodies(5), 4, 1)).toEqual({
      type: 'page',
      delta: 1,
      edge: 'first',
    } as StepResult);
  });

  test('▲ on first line → previous page, last line', () => {
    expect(stepLine(bodies(5), 0, -1)).toEqual({
      type: 'page',
      delta: -1,
      edge: 'last',
    } as StepResult);
  });

  test('empty line list → empty (UI: "no text — tap ▼ to skip page")', () => {
    expect(stepLine([], 0, 1)).toEqual({ type: 'empty' });
    expect(stepLine([], 0, -1)).toEqual({ type: 'empty' });
  });

  test('invalid dir throws', () => {
    expect(() => stepLine(bodies(3), 1, 0 as 1)).toThrow(/dir must be 1 or -1/);
  });

  test('single line: both directions cross pages', () => {
    const lines = bodies(1);
    expect(stepLine(lines, 0, 1)).toEqual({
      type: 'page',
      delta: 1,
      edge: 'first',
    });
    expect(stepLine(lines, 0, -1)).toEqual({
      type: 'page',
      delta: -1,
      edge: 'last',
    });
  });
});

describe('stepLine — skipMargins', () => {
  // idx:        0      1        2      3        4
  const lines = mkLines(['body', 'margin', 'body', 'margin', 'body']);

  test('▼ skips margin lines', () => {
    expect(stepLine(lines, 0, 1, { skipMargins: true })).toEqual({
      type: 'line',
      idx: 2,
    });
    expect(stepLine(lines, 2, 1, { skipMargins: true })).toEqual({
      type: 'line',
      idx: 4,
    });
  });

  test('▼ on last body line → next page', () => {
    expect(stepLine(lines, 4, 1, { skipMargins: true })).toEqual({
      type: 'page',
      delta: 1,
      edge: 'first',
    });
  });

  test('▲ on first body line → previous page', () => {
    expect(stepLine(lines, 0, -1, { skipMargins: true })).toEqual({
      type: 'page',
      delta: -1,
      edge: 'last',
    });
  });

  test('▲ from a body line skips margins backwards', () => {
    expect(stepLine(lines, 4, -1, { skipMargins: true })).toEqual({
      type: 'line',
      idx: 2,
    });
  });

  test('ruler sitting on a margin line moves to nearest steppable in dir', () => {
    expect(stepLine(lines, 1, 1, { skipMargins: true })).toEqual({
      type: 'line',
      idx: 2,
    });
    expect(stepLine(lines, 1, -1, { skipMargins: true })).toEqual({
      type: 'line',
      idx: 0,
    });
  });

  test('without skipMargins, stepping lands on margin lines', () => {
    expect(stepLine(lines, 0, 1)).toEqual({ type: 'line', idx: 1 });
  });

  test('all lines filtered out → empty', () => {
    const allMargins = mkLines(['margin', 'margin']);
    expect(stepLine(allMargins, 0, 1, { skipMargins: true })).toEqual({
      type: 'empty',
    });
    expect(firstSteppable(allMargins, true)).toBeNull();
    expect(lastSteppable(allMargins, true)).toBeNull();
  });

  test('firstSteppable / lastSteppable helpers', () => {
    expect(firstSteppable(lines, true)).toBe(0);
    expect(lastSteppable(lines, true)).toBe(4);
    expect(firstSteppable(lines)).toBe(0);
    expect(lastSteppable(lines)).toBe(4);
    expect(firstSteppable([], true)).toBeNull();
  });
});

describe('stepLine — cross-page sequences', () => {
  // Simulate the ruler store: step, turn page on {type:'page'}, skip empties.
  const walk = (
    pages: Line[][],
    startPage: number,
    startIdx: number,
    dir: 1 | -1,
  ): string[] => {
    const visited: string[] = [];
    let p = startPage;
    let idx = startIdx;
    for (let guard = 0; guard < 50; guard++) {
      if (p < 0 || p >= pages.length) {
        visited.push('END');
        break;
      }
      if (pages[p].length === 0) {
        visited.push(`${p}:skip-empty`);
        p += dir;
        continue;
      }
      visited.push(`${p}:${idx}`);
      const step = stepLine(pages[p], idx, dir);
      if (step.type === 'line') {
        idx = step.idx;
      } else if (step.type === 'page') {
        p += step.delta;
        // Caller lands on the requested edge of the new page (empties
        // skipped by the loop above).
        let q = p;
        while (q >= 0 && q < pages.length && pages[q].length === 0) {
          visited.push(`${q}:skip-empty`);
          q += step.delta;
        }
        p = q;
        if (p < 0 || p >= pages.length) {
          visited.push('END');
          break;
        }
        idx = step.edge === 'first' ? 0 : pages[p].length - 1;
      } else {
        p += dir; // empty page: skip
      }
    }
    return visited;
  };

  const pages = [bodies(3), [], bodies(2)];

  test('▼ walks A0→A1→A2, skips empty B, C0→C1, then past the end', () => {
    expect(walk(pages, 0, 0, 1)).toEqual([
      '0:0',
      '0:1',
      '0:2',
      '1:skip-empty',
      '2:0',
      '2:1',
      'END',
    ]);
  });

  test('▲ from C0 goes to B(skip) → A last line, then back to start', () => {
    expect(walk(pages, 2, 0, -1)).toEqual([
      '2:0',
      '1:skip-empty',
      '0:2',
      '0:1',
      '0:0',
      'END',
    ]);
  });

  test('PRD acceptance shape: ▼ on last line of p.10 → p.11 first line', () => {
    const ten = bodies(4);
    const eleven = bodies(4);
    const step = stepLine(ten, 3, 1);
    expect(step).toEqual({ type: 'page', delta: 1, edge: 'first' });
    // Caller turns to p.11 and places the ruler per the edge hint:
    const landed = step.type === 'page' && step.edge === 'first' ? 0 : -1;
    expect(landed).toBe(0);
    expect(eleven[landed].idx).toBe(0);
  });
});
