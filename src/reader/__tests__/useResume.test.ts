/**
 * useResume.test.ts — unit tests for the resume controller.
 *
 * The DB layer is faked by jest.mock('../../data/positions') with an
 * in-memory store (dependency injection of getPosition/savePosition, per
 * the spec), and AppState is faked by mocking the local './appState'
 * shim — a captured listener we invoke directly to simulate backgrounding.
 */

import type { Line } from '../../engine/lines';
import { RESUME_SAVE_DEBOUNCE_MS, ResumeController, type ResumeCallbacks } from '../useResume';
import type { SavedPosition } from '../../data/positions';

jest.mock('../../data/positions', () => ({
  getPosition: jest.fn(),
  savePosition: jest.fn(),
  pushHistory: jest.fn(),
  getHistory: jest.fn(),
  clearPosition: jest.fn(),
}));

jest.mock('../appState', () => {
  const state: { handler: ((s: string) => void) | null } = { handler: null };
  return {
    addAppStateListener: (h: (s: string) => void) => {
      state.handler = h;
      return {
        remove: () => {
          state.handler = null;
        },
      };
    },
    __emitAppState: (s: string) => state.handler?.(s),
  };
});

const mockPositions = jest.requireMock('../../data/positions') as {
  getPosition: jest.Mock;
  savePosition: jest.Mock;
  pushHistory: jest.Mock;
};

const mockAppState = jest.requireMock('../appState') as {
  __emitAppState: (s: string) => void;
};

/* ---------------- fixtures ---------------- */

const mkLines = (texts: string[]): Line[] =>
  texts.map((text, i) => ({
    idx: i,
    text,
    box: { x0: 0.05, y0: i / texts.length, x1: 0.95, y1: (i + 1) / texts.length },
    words: [],
    kind: 'body' as const,
  }));

const TEXTS = [
  'Chapter one begins with a quiet morning in the village square',
  'The quick brown fox jumps over the lazy dog near the river',
  'Meditations on first philosophy require careful slow reading',
  'A long line about geometry and normalized coordinates here',
  'The ruler advances one line at a time with a gentle haptic',
  'Annotations persist across sessions via the operation log',
  'Every highlight can be undone and redone without any loss',
  'The quick brown fox returns again in a later paragraph',
  'Final thoughts on resuming exactly where you left off',
  'Appendix with references and further reading material',
];

const saved = (overrides: Partial<SavedPosition> = {}): SavedPosition => ({
  page: 5,
  line_index: 3,
  y_norm: 0.35,
  snippet: TEXTS[3].slice(0, 48),
  ruler_enabled: 1,
  ...overrides,
});

function makeCb(lines: Line[] | null = mkLines(TEXTS), throwOnLines = false) {
  const onRestore = jest.fn();
  const cb: ResumeCallbacks = {
    getLines: throwOnLines
      ? jest.fn().mockRejectedValue(new Error('engine not ready'))
      : jest.fn().mockResolvedValue(lines),
    onRestore,
  };
  return { cb, onRestore };
}

function makeController(
  bookId = 'book-1',
  cbParts?: { cb: ResumeCallbacks; onRestore: jest.Mock },
) {
  const parts = cbParts ?? makeCb();
  const ctrl = new ResumeController(bookId, parts.cb);
  return { ctrl, ...parts };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPositions.getPosition.mockResolvedValue(null);
  mockPositions.savePosition.mockResolvedValue(undefined);
  mockPositions.pushHistory.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

/* ---------------- restore() ---------------- */

describe('restore', () => {
  test('no saved position → page 1, top, no line', async () => {
    const { ctrl, onRestore, cb } = makeController();
    await ctrl.restore();
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith({ page: 1, yNorm: 0, lineIndex: null, rulerEnabled: false });
    expect(cb.getLines).not.toHaveBeenCalled();
    ctrl.dispose();
  });

  test('exact line hit → saved line index', async () => {
    mockPositions.getPosition.mockResolvedValue(saved());
    const { ctrl, onRestore } = makeController();
    await ctrl.restore();
    expect(onRestore).toHaveBeenCalledWith({ page: 5, yNorm: 0.35, lineIndex: 3, rulerEnabled: true });
    ctrl.dispose();
  });

  test('snippet moved after re-index → re-found at new index', async () => {
    mockPositions.getPosition.mockResolvedValue(saved());
    // Re-index shuffled the snippet from index 3 to index 7.
    const moved = [...TEXTS];
    const [snip] = moved.splice(3, 1);
    moved.splice(7, 0, snip);
    const { ctrl, onRestore } = makeController('book-1', makeCb(mkLines(moved)));
    await ctrl.restore();
    expect(onRestore).toHaveBeenCalledWith({ page: 5, yNorm: 0.35, lineIndex: 7, rulerEnabled: true });
    ctrl.dispose();
  });

  test('no lines (scan page) → y_norm only, lineIndex null', async () => {
    mockPositions.getPosition.mockResolvedValue(saved({ y_norm: 0.62 }));
    const { ctrl, onRestore } = makeController('book-1', makeCb([]));
    await ctrl.restore();
    expect(onRestore).toHaveBeenCalledWith({ page: 5, yNorm: 0.62, lineIndex: null, rulerEnabled: true });
    ctrl.dispose();
  });

  test('getLines throws → y_norm only, lineIndex null', async () => {
    mockPositions.getPosition.mockResolvedValue(saved({ y_norm: 0.71 }));
    const { ctrl, onRestore } = makeController('book-1', makeCb(null, true));
    await ctrl.restore();
    expect(onRestore).toHaveBeenCalledWith({ page: 5, yNorm: 0.71, lineIndex: null, rulerEnabled: true });
    ctrl.dispose();
  });

  test('restore syncs the ruler flag into subsequent saves', async () => {
    jest.useFakeTimers();
    mockPositions.getPosition.mockResolvedValue(saved({ ruler_enabled: 1 }));
    const { ctrl } = makeController();
    await ctrl.restore();
    ctrl.reportPage(6, 2, 0.2, 'some line');
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS);
    expect(mockPositions.savePosition).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ ruler_enabled: 1 }),
    );
    ctrl.dispose();
  });
});

/* ---------------- debounce ---------------- */

describe('debounce', () => {
  test('rapid reportPage calls coalesce into one save with latest values', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.reportPage(5, 1, 0.1, 'first');
    ctrl.reportPage(5, 2, 0.2, 'second');
    ctrl.reportPage(5, 3, 0.3, 'third');
    expect(mockPositions.savePosition).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    expect(mockPositions.savePosition).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ page: 5, line_index: 3, y_norm: 0.3, snippet: 'third' }),
    );
    ctrl.dispose();
  });

  test('page and ruler channels debounce independently', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.reportPage(5, 1, 0.1, 'page-line');
    ctrl.reportRuler(4, 0.4, 'ruler-line');
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(2);
    ctrl.dispose();
  });

  test('flush writes pending saves immediately without waiting', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.reportPage(5, 2, 0.2, 'pending');
    await ctrl.flush();
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    expect(mockPositions.savePosition).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ line_index: 2, snippet: 'pending' }),
    );
    // The consumed timer must not fire again later.
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS * 2);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    ctrl.dispose();
  });

  test('flush with nothing pending is a no-op', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.flush()).resolves.toBeUndefined();
    expect(mockPositions.savePosition).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});

/* ---------------- history ---------------- */

describe('history', () => {
  test('push on page change only — not on ruler steps', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();

    ctrl.reportPage(5, 1, 0.1, 'p5');
    await ctrl.flush();
    expect(mockPositions.pushHistory).toHaveBeenCalledTimes(1);
    expect(mockPositions.pushHistory).toHaveBeenCalledWith(
      'book-1',
      expect.objectContaining({ page: 5 }),
    );

    // Ruler steps on the same page: save, but no history push.
    ctrl.reportRuler(2, 0.2, 'r1');
    ctrl.reportRuler(3, 0.3, 'r2');
    await ctrl.flush();
    expect(mockPositions.pushHistory).toHaveBeenCalledTimes(1);

    // Same page reported again: still no push.
    ctrl.reportPage(5, 4, 0.4, 'p5-again');
    await ctrl.flush();
    expect(mockPositions.pushHistory).toHaveBeenCalledTimes(1);

    // New page: push.
    ctrl.reportPage(6, 0, 0.05, 'p6');
    await ctrl.flush();
    expect(mockPositions.pushHistory).toHaveBeenCalledTimes(2);
    expect(mockPositions.pushHistory).toHaveBeenLastCalledWith(
      'book-1',
      expect.objectContaining({ page: 6 }),
    );
    ctrl.dispose();
  });

  test('restored page is not re-pushed as a change', async () => {
    jest.useFakeTimers();
    mockPositions.getPosition.mockResolvedValue(saved({ page: 5 }));
    const { ctrl } = makeController();
    await ctrl.restore();
    // Re-reporting the restored page must not push history.
    ctrl.reportPage(5, 3, 0.35, TEXTS[3].slice(0, 48));
    await ctrl.flush();
    expect(mockPositions.pushHistory).not.toHaveBeenCalled();
    ctrl.dispose();
  });
});

/* ---------------- AppState ---------------- */

describe('AppState', () => {
  test('background flushes pending saves (simulated via direct listener call)', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.reportPage(7, 1, 0.1, 'before-bg');
    expect(mockPositions.savePosition).not.toHaveBeenCalled();
    mockAppState.__emitAppState('background');
    // flush() is fire-and-forget inside the listener; let it settle.
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    ctrl.dispose();
  });

  test('inactive also flushes; active does not', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.reportRuler(1, 0.1, 'r');
    mockAppState.__emitAppState('active');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPositions.savePosition).not.toHaveBeenCalled();

    mockAppState.__emitAppState('inactive');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    ctrl.dispose();
  });

  test('dispose unsubscribes: background after dispose does nothing', async () => {
    jest.useFakeTimers();
    const { ctrl } = makeController();
    ctrl.dispose();
    ctrl.reportPage(8, 1, 0.1, 'after-dispose');
    mockAppState.__emitAppState('background');
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS * 2);
    // Only the debounced timer fired; the AppState listener was gone.
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    // Prove the listener is gone: a second pending report is NOT flushed by AppState.
    ctrl.reportPage(9, 1, 0.1, 'second');
    mockAppState.__emitAppState('background');
    await jest.advanceTimersByTimeAsync(0);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(RESUME_SAVE_DEBOUNCE_MS);
    expect(mockPositions.savePosition).toHaveBeenCalledTimes(2);
  });
});
