/**
 * sessions.test.ts — SessionTracker math, streak math, weekly aggregation (M5).
 *
 * The tracker is clock-injectable; the aggregations run against a real
 * SQLite engine (better-sqlite3) through the same jest.mock harness as the
 * search/positions tests.
 */

jest.mock('../../data/db', () => {
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SCHEMA_STATEMENTS_V1 } = require('../../data/schema');
  const raw = new Database(':memory:');
  for (const stmt of SCHEMA_STATEMENTS_V1) {
    raw.exec(stmt);
  }

  const toArray = (params: unknown): unknown[] =>
    params === undefined ? [] : Array.isArray(params) ? params : [params];

  const fake = {
    getFirstAsync: (sql: string, params?: unknown) =>
      Promise.resolve(raw.prepare(sql).get(toArray(params)) ?? null),
    getAllAsync: (sql: string, params?: unknown) =>
      Promise.resolve(raw.prepare(sql).all(toArray(params))),
    runAsync: (sql: string, params?: unknown) => {
      const info = raw.prepare(sql).run(toArray(params)) as {
        changes: number;
        lastInsertRowid?: number | bigint;
        lastInsertRowId?: number | bigint;
      };
      // better-sqlite3 spells it `lastInsertRowid`; expo-sqlite `lastInsertRowId`.
      const rowId = info.lastInsertRowid ?? info.lastInsertRowId ?? 0;
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(rowId),
      });
    },
  };

  return {
    getDb: () => Promise.resolve(fake),
    withTransaction: <T>(task: (db: unknown) => Promise<T>): Promise<T> => task(fake),
    closeDb: () => Promise.resolve(),
    __raw: raw,
  };
});

import {
  DEFAULT_GOAL,
  IDLE_MS,
  SessionTracker,
  dayString,
  endSession,
  getGoal,
  getStreak,
  getWeeklyPages,
  setGoal,
  shiftDay,
  startSession,
} from '../sessions';

const mockDb = jest.requireMock('../../data/db') as { __raw: any };

function clearSessions() {
  mockDb.__raw.exec('DELETE FROM sessions;');
}

/** Insert a finished session row directly (bypasses the tracker). */
function seedSession(bookId: string, dayTs: number, pages: number, activeSeconds: number) {
  mockDb.__raw
    .prepare(
      'INSERT INTO sessions (book_id, started_at, ended_at, pages_read, active_seconds) VALUES (?, ?, ?, ?, ?)',
    )
    .run(bookId, dayTs, dayTs + activeSeconds * 1000, pages, activeSeconds);
}

/** ms timestamp for local noon on a `YYYY-MM-DD` day. */
function noon(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

describe('SessionTracker', () => {
  test('counts distinct pages and wall time', () => {
    let t = 0;
    const tr = new SessionTracker(() => t);
    tr.start(10);
    t = 30_000;
    tr.recordPage(11);
    t = 60_000;
    tr.recordPage(10); // revisit — still one distinct page
    const done = tr.finish();
    expect(done.pagesRead).toBe(2);
    expect(done.activeSeconds).toBe(60);
  });

  test('subtracts backgrounded gaps', () => {
    let t = 0;
    const tr = new SessionTracker(() => t);
    tr.start(1);
    t = 100_000;
    tr.markInteraction(); // last touch at 100s
    tr.onBackground(); // gap 100s → 300s
    t = 300_000;
    tr.onForeground();
    t = 340_000; // 40 s more, touch at foreground
    const done = tr.finish();
    // Segment 1: min(100s, 100s+60s) - 0 = 100s. Segment 2: 40s. Total 140s.
    expect(done.activeSeconds).toBe(140);
  });

  test('idle tail beyond 60 s is excluded', () => {
    let t = 0;
    const tr = new SessionTracker(() => t);
    tr.start(1);
    t = 10_000;
    tr.markInteraction();
    t = 10_000 + IDLE_MS + 50_000; // 120 s of no touch
    const done = tr.finish();
    // Active until lastTouch(10s) + 60s = 70s.
    expect(done.activeSeconds).toBe(70);
  });

  test('background without foreground still closes on finish', () => {
    let t = 0;
    const tr = new SessionTracker(() => t);
    tr.start(3);
    t = 45_000;
    tr.onBackground();
    t = 999_000; // long gap, never foregrounded
    const done = tr.finish();
    expect(done.activeSeconds).toBe(45);
    expect(done.pagesRead).toBe(1);
  });

  test('double onForeground is a no-op', () => {
    let t = 0;
    const tr = new SessionTracker(() => t);
    tr.start(1);
    t = 20_000;
    tr.onForeground();
    tr.onForeground();
    const done = tr.finish();
    expect(done.activeSeconds).toBe(20);
  });
});

describe('startSession / endSession', () => {
  test('round-trips a session row', async () => {
    clearSessions();
    const id = await startSession('b1');
    expect(id).toBeGreaterThan(0);
    await endSession(id, { pagesRead: 7, activeSeconds: 300 });
    const row = mockDb.__raw
      .prepare('SELECT book_id, pages_read, active_seconds FROM sessions WHERE id = ?')
      .get(id);
    expect(row).toMatchObject({ book_id: 'b1', pages_read: 7, active_seconds: 300 });
    expect(row.ended_at).toBeUndefined(); // not selected; just checking the core cols
  });
});

describe('getStreak', () => {
  const TODAY = '2026-10-18';

  beforeEach(clearSessions);

  test('consecutive days ending today', async () => {
    seedSession('b1', noon('2026-10-16'), 5, 120);
    seedSession('b1', noon('2026-10-17'), 5, 120);
    seedSession('b1', noon('2026-10-18'), 5, 120);
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(3);
  });

  test('streak survives a missing today (counts from yesterday)', async () => {
    seedSession('b1', noon('2026-10-16'), 5, 120);
    seedSession('b1', noon('2026-10-17'), 5, 120);
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(2);
  });

  test('a gap day breaks the streak', async () => {
    seedSession('b1', noon('2026-10-15'), 5, 120);
    // 16th missing
    seedSession('b1', noon('2026-10-17'), 5, 120);
    seedSession('b1', noon('2026-10-18'), 5, 120);
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(2);
  });

  test('no sessions → 0', async () => {
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(0);
  });

  test('zero-active sessions do not count', async () => {
    seedSession('b1', noon('2026-10-18'), 0, 0);
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(0);
  });

  test('streak can be book-scoped or global', async () => {
    seedSession('b1', noon('2026-10-18'), 5, 120);
    seedSession('b2', noon('2026-10-17'), 5, 120);
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(1);
    await expect(getStreak(undefined, noon(TODAY))).resolves.toBe(2);
  });

  test('unfinished (crashed) sessions are ignored', async () => {
    mockDb.__raw
      .prepare('INSERT INTO sessions (book_id, started_at, pages_read, active_seconds) VALUES (?, ?, 0, 0)')
      .run('b1', noon('2026-10-18'));
    await expect(getStreak('b1', noon(TODAY))).resolves.toBe(0);
  });
});

describe('getWeeklyPages', () => {
  beforeEach(clearSessions);

  test('last 7 days oldest-first, zeros for missing days', async () => {
    const today = '2026-10-18';
    seedSession('b1', noon('2026-10-18'), 12, 600);
    seedSession('b1', noon('2026-10-16'), 4, 200);
    seedSession('b1', noon('2026-10-16'), 6, 100); // same day sums
    const weeks = await getWeeklyPages('b1', noon(today));
    expect(weeks).toHaveLength(7);
    expect(weeks[0].day).toBe('2026-10-12');
    expect(weeks[6].day).toBe('2026-10-18');
    const byDay = new Map(weeks.map((w) => [w.day, w.pages]));
    expect(byDay.get('2026-10-18')).toBe(12);
    expect(byDay.get('2026-10-16')).toBe(10);
    expect(byDay.get('2026-10-15')).toBe(0);
  });
});

describe('dayString / shiftDay', () => {
  test('round-trips local days across month boundaries', () => {
    expect(dayString(noon('2026-10-18'))).toBe('2026-10-18');
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2026-10-18', -6)).toBe('2026-10-12');
  });
});

describe('getGoal / setGoal', () => {
  beforeEach(() => {
    mockDb.__raw.exec("DELETE FROM settings WHERE key = 'stats.goal';");
  });

  test('defaults to 20 pages', async () => {
    await expect(getGoal()).resolves.toEqual(DEFAULT_GOAL);
    expect(DEFAULT_GOAL).toEqual({ kind: 'pages', value: 20 });
  });

  test('round-trips a minutes goal', async () => {
    await setGoal({ kind: 'minutes', value: 30 });
    await expect(getGoal()).resolves.toEqual({ kind: 'minutes', value: 30 });
  });

  test('corrupt / invalid stored goal falls back to default', async () => {
    mockDb.__raw
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)')
      .run('stats.goal', '{"kind":"lightyears","value":-5}');
    await expect(getGoal()).resolves.toEqual(DEFAULT_GOAL);
    mockDb.__raw.exec("DELETE FROM settings WHERE key = 'stats.goal';");
    mockDb.__raw
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?)')
      .run('stats.goal', 'not-json{');
    await expect(getGoal()).resolves.toEqual(DEFAULT_GOAL);
  });
});
