/**
 * useRuler.test.ts — unit tests for the reading-ruler state machine.
 *
 * RulerController holds all of useRuler's transition logic and is
 * platform-free, so it is tested directly with a fake reader
 * (fake getLines/turnPage/getRowProfile). The '../rulerSettings' module is
 * mocked with an in-memory store; haptics stay off (expo-haptics is never
 * imported — the hook wires it via a dynamic import).
 */

import { RulerController, type RowProfile } from '../useRuler';
import type { Line } from '../../engine/lines';

const BASE_SETTINGS = {
  color: '#FFB020',
  opacity: 0.22,
  lines: 1 as const,
  glide: true,
  haptics: false,
  skipHeaders: true,
  style: 'band' as const,
  padding: 0.003,
  side: 'right' as const,
};
let mockSettings: {
  color: string;
  opacity: number;
  lines: 1 | 2 | 3;
  glide: boolean;
  haptics: boolean;
  skipHeaders: boolean;
  style: 'band' | 'spotlight' | 'underline';
  padding: number;
  side: 'left' | 'right';
} = { ...BASE_SETTINGS };

jest.mock('../rulerSettings', () => ({
  DEFAULT_RULER_SETTINGS: {
    color: '#FFB020',
    opacity: 0.22,
    lines: 1,
    glide: true,
    haptics: false,
    skipHeaders: true,
    style: 'band',
    padding: 0.003,
    side: 'right',
  },
  getRulerSettings: async () => ({ ...mockSettings }),
  setRulerSettings: async (patch: Record<string, unknown>) => {
    mockSettings = { ...mockSettings, ...patch };
    return { ...mockSettings };
  },
}));

const mkLine = (idx: number, n: number, kind: 'body' | 'margin' = 'body'): Line => ({
  idx,
  text: `line ${idx}`,
  box: { x0: 0.1, y0: idx / n, x1: 0.9, y1: (idx + 1) / n },
  words: [],
  kind,
});

const mkPage = (n: number, kinds?: Array<'body' | 'margin'>): Line[] =>
  Array.from({ length: n }, (_, i) => mkLine(i, n, kinds?.[i] ?? 'body'));

interface FakeReader {
  page(): number;
  turnCalls(): Array<1 | -1>;
  getLines(p: number): Promise<Line[]>;
  turnPage(d: 1 | -1): Promise<void>;
  getRowProfile?: (p: number) => Promise<RowProfile>;
}

function makeReader(o: {
  pages: Record<number, Line[]>;
  rowProfiles?: Record<number, RowProfile>;
  failLines?: boolean;
  onReport?: (i: number, y: number, s: string) => void;
  onEnabled?: (b: boolean) => void;
}): FakeReader & {
  reports: Array<{ i: number; y: number; s: string }>;
  enabled: boolean[];
  _onReport(i: number, y: number, s: string): void;
  _onEnabled(b: boolean): void;
} {
  const keys = Object.keys(o.pages).map(Number);
  const maxPage = keys.length > 0 ? Math.max(...keys) : 1;
  let page = 1;
  const turnCalls: Array<1 | -1> = [];
  const reports: Array<{ i: number; y: number; s: string }> = [];
  const enabled: boolean[] = [];
  const reader: FakeReader = {
    page: () => page,
    turnCalls: () => turnCalls,
    getLines: async (p: number) => {
      if (o.failLines) throw new Error('engine down');
      return o.pages[p] ?? [];
    },
    turnPage: async (d: 1 | -1) => {
      turnCalls.push(d);
      page = Math.min(maxPage, Math.max(1, page + d)); // clamp: book ends
    },
  };
  if (o.rowProfiles) {
    reader.getRowProfile = async (p: number) =>
      o.rowProfiles![p] ?? { rowSums: [], widthPx: 0 };
  }
  return {
    ...reader,
    reports,
    enabled,
    // reportRuler / setRulerEnabled targets, wired in makeController
    _onReport: (i: number, y: number, s: string) => {
      reports.push({ i, y, s });
      o.onReport?.(i, y, s);
    },
    _onEnabled: (b: boolean) => {
      enabled.push(b);
      o.onEnabled?.(b);
    },
  };
}

async function makeController(
  r: FakeReader & { _onReport(i: number, y: number, s: string): void; _onEnabled(b: boolean): void },
) {
  const stepped: number[] = [];
  const ctl = new RulerController({
    getPage: () => r.page(),
    getLines: (p) => r.getLines(p),
    turnPage: (d) => r.turnPage(d),
    getRowProfile: r.getRowProfile,
    reportRuler: (i, y, s) => r._onReport(i, y, s),
    setRulerEnabled: (b) => r._onEnabled(b),
    onStepped: () => {
      stepped.push(1);
    },
  });
  await ctl.init();
  return { ctl, stepped };
}

/** Drain the microtask/macrotask queue behind toggle()'s async landing. */
async function flush(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((res) => setTimeout(res, 0));
  }
}

beforeEach(() => {
  mockSettings = { ...BASE_SETTINGS };
});

describe('RulerController — cross-page stepping', () => {
  test('walks lines then crosses pages (3 pages)', async () => {
    const r = makeReader({ pages: { 1: mkPage(3), 2: mkPage(3), 3: mkPage(3) } });
    const { ctl, stepped } = await makeController(r);

    ctl.toggle();
    await flush();
    expect(ctl.enabled).toBe(true);
    expect(ctl.lineIndex).toBe(0);
    expect(r.page()).toBe(1);
    expect(r.enabled).toEqual([true]);

    await ctl.step(1);
    expect(ctl.lineIndex).toBe(1);
    await ctl.step(1);
    expect(ctl.lineIndex).toBe(2);

    await ctl.step(1); // page edge → next page
    expect(r.turnCalls()).toEqual([1]);
    expect(r.page()).toBe(2);
    expect(ctl.lineIndex).toBe(0);

    await ctl.step(1);
    await ctl.step(1);
    await ctl.step(1);
    expect(r.page()).toBe(3);
    expect(ctl.lineIndex).toBe(0);
    expect(r.turnCalls()).toEqual([1, 1]);

    await ctl.step(-1); // back over the edge → previous page, last line
    expect(r.turnCalls()).toEqual([1, 1, -1]);
    expect(r.page()).toBe(2);
    expect(ctl.lineIndex).toBe(2);

    expect(stepped.length).toBeGreaterThan(0);
    expect(r.reports[0]).toMatchObject({ i: 0, s: 'line 0' });
    expect(r.reports[0].y).toBeCloseTo(1 / 6, 3);
  });

  test('book boundary: turnPage no-op keeps the ruler in place', async () => {
    const r = makeReader({ pages: { 1: mkPage(2) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    await ctl.step(1);
    expect(ctl.lineIndex).toBe(1);
    await ctl.step(1); // tries to turn past the last page
    expect(r.turnCalls()).toEqual([1]);
    expect(r.page()).toBe(1);
    expect(ctl.lineIndex).toBe(1); // unchanged
  });

  test('step while disabled is a no-op', async () => {
    const r = makeReader({ pages: { 1: mkPage(2) } });
    const { ctl } = await makeController(r);
    await ctl.step(1);
    expect(ctl.lineIndex).toBeNull();
    expect(r.turnCalls()).toEqual([]);
  });
});

describe('RulerController — empty pages', () => {
  test('parks hidden on a text-less page; ▼ skips it', async () => {
    const r = makeReader({ pages: { 1: mkPage(2), 2: [], 3: mkPage(2) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    await ctl.step(1);
    expect(ctl.lineIndex).toBe(1);

    await ctl.step(1); // page edge → empty page 2
    expect(r.turnCalls()).toEqual([1]);
    expect(r.page()).toBe(2);
    expect(ctl.lineIndex).toBeNull();
    expect(ctl.emptyPage).toBe(true);
    expect(ctl.bandBox()).toBeNull(); // hidden: UI shows the skip message

    await ctl.step(1); // ▼ on the empty page skips it
    expect(r.turnCalls()).toEqual([1, 1]);
    expect(r.page()).toBe(3);
    expect(ctl.lineIndex).toBe(0);
    expect(ctl.emptyPage).toBe(false);

    await ctl.step(-1); // back over the edge → parks on page 2 again
    expect(r.turnCalls()).toEqual([1, 1, -1]);
    expect(r.page()).toBe(2);
    expect(ctl.emptyPage).toBe(true);
    expect(ctl.lineIndex).toBeNull();
  });

  test('getLines failure is treated as empty, never throws', async () => {
    const r = makeReader({ pages: {}, failLines: true });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    expect(ctl.emptyPage).toBe(true);
    expect(ctl.lineIndex).toBeNull();
  });
});

describe('RulerController — skipMargins', () => {
  const kinds: Array<'body' | 'margin'> = ['margin', 'body', 'body', 'margin'];

  test('skips header/footer lines when skipHeaders is on', async () => {
    const r = makeReader({ pages: { 1: mkPage(4, kinds), 2: mkPage(2) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    expect(ctl.lineIndex).toBe(1); // first steppable, not the header
    await ctl.step(1);
    expect(ctl.lineIndex).toBe(2);
    await ctl.step(1); // past last body line → next page (footer skipped)
    expect(r.turnCalls()).toEqual([1]);
    expect(r.page()).toBe(2);
    expect(ctl.lineIndex).toBe(0);
  });

  test('lands on margin lines when skipHeaders is off', async () => {
    mockSettings = { ...BASE_SETTINGS, skipHeaders: false };
    const r = makeReader({ pages: { 1: mkPage(4, kinds) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    expect(ctl.lineIndex).toBe(0);
    await ctl.step(1);
    expect(ctl.lineIndex).toBe(1);
  });
});

describe('RulerController — toggle contract', () => {
  test('toggle flips enabled, persists, and hides on disable', async () => {
    const r = makeReader({ pages: { 1: mkPage(2) } });
    const { ctl } = await makeController(r);

    ctl.toggle();
    await flush();
    expect(ctl.enabled).toBe(true);
    expect(r.enabled).toEqual([true]);

    ctl.toggle();
    expect(ctl.enabled).toBe(false);
    expect(ctl.lineIndex).toBeNull();
    expect(ctl.bandBox()).toBeNull();
    expect(r.enabled).toEqual([true, false]);
  });
});

describe('RulerController — bandBox', () => {
  test('covers N lines per settings.lines, with padding', async () => {
    mockSettings = { ...BASE_SETTINGS, lines: 3 };
    const r = makeReader({ pages: { 1: mkPage(5) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();

    const box = ctl.bandBox();
    expect(box).not.toBeNull();
    expect(box!.x0).toBeCloseTo(0.1 - 0.003, 4);
    expect(box!.x1).toBeCloseTo(0.9 + 0.003, 4);
    expect(box!.y0).toBe(0); // clamped: 0 - pad
    expect(box!.y1).toBeCloseTo(0.6 + 0.003, 4);

    await ctl.step(1);
    const box2 = ctl.bandBox();
    expect(box2!.y0).toBeCloseTo(0.2 - 0.003, 4);
    expect(box2!.y1).toBeCloseTo(0.8 + 0.003, 4);
  });

  test('single-line band by default', async () => {
    const r = makeReader({ pages: { 1: mkPage(5) } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    await ctl.step(1);
    await ctl.step(1); // line 2: no edge clamping (y0=0.4, y1=0.6)
    const box = ctl.bandBox();
    expect(box!.y0).toBeCloseTo(0.4 - 0.003, 4);
    expect(box!.y1).toBeCloseTo(0.6 + 0.003, 4);
    expect(box!.y1 - box!.y0).toBeCloseTo(0.2 + 2 * 0.003, 4);
  });
});

describe('RulerController — pixel mode', () => {
  const W = 100;
  const H = 20;
  const darkSum = Math.round(0.3 * W * 255);
  const sums = new Array(H).fill(0);
  for (const y of [4, 5, 10, 11, 15, 16]) sums[y] = darkSum;
  const profile: RowProfile = { rowSums: sums, widthPx: W };

  test('scan page: lands on first row, steps rows, reports y_norm-only', async () => {
    const r = makeReader({ pages: { 1: [] }, rowProfiles: { 1: profile } });
    const { ctl, stepped } = await makeController(r);

    ctl.toggle();
    await flush();
    expect(ctl.pixelY).toBeCloseTo(0.25, 2);
    expect(ctl.lineIndex).toBeNull();
    expect(ctl.emptyPage).toBe(false);

    await ctl.step(1);
    expect(ctl.pixelY).toBeCloseTo(0.55, 2);
    await ctl.step(-1);
    expect(ctl.pixelY).toBeCloseTo(0.25, 2);

    // y_norm-only resume: line_index -1 sentinel (PRD §6.4).
    expect(r.reports[0]).toMatchObject({ i: -1, s: '' });
    expect(r.reports[0].y).toBeCloseTo(0.25, 2);
    expect(stepped.length).toBeGreaterThan(0);

    // Pixel band box: median gap 0.275 → clamped height 0.06.
    const box = ctl.bandBox();
    expect(box!.x0).toBeCloseTo(0.06 - 0.003, 3);
    expect(box!.x1).toBeCloseTo(0.94 + 0.003, 3);
    expect(box!.y0).toBeCloseTo(0.25 - 0.03 - 0.003, 3);
    expect(box!.y1).toBeCloseTo(0.25 + 0.03 + 0.003, 3);
  });

  test('▲ past the first row turns the page; boundary keeps position', async () => {
    const r = makeReader({ pages: { 1: [] }, rowProfiles: { 1: profile } });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    await ctl.step(-1);
    expect(r.turnCalls()).toEqual([-1]);
    expect(r.page()).toBe(1); // clamped: no page 0
    expect(ctl.pixelY).toBeCloseTo(0.25, 2); // unchanged
  });

  test('detection finds no rows → parks hidden like a blank page', async () => {
    const r = makeReader({
      pages: { 1: [] },
      rowProfiles: { 1: { rowSums: new Array(20).fill(0), widthPx: 100 } },
    });
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();
    expect(ctl.pixelY).toBeNull();
    expect(ctl.emptyPage).toBe(true);
  });
});

describe('RulerController — re-entrancy', () => {
  test('concurrent steps never interleave', async () => {
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const r = makeReader({ pages: { 1: mkPage(1), 2: mkPage(1) } });
    const origTurn = r.turnPage.bind(r);
    let gated = true;
    r.turnPage = async (d: 1 | -1) => {
      if (gated) {
        gated = false;
        await gate;
      }
      return origTurn(d);
    };
    const { ctl } = await makeController(r);
    ctl.toggle();
    await flush();

    const p1 = ctl.step(1);
    const p2 = ctl.step(1); // dropped: a step is already in flight
    release();
    await p1;
    await p2;
    expect(r.turnCalls()).toEqual([1]);
    expect(r.page()).toBe(2);
    expect(ctl.lineIndex).toBe(0);
  });
});
