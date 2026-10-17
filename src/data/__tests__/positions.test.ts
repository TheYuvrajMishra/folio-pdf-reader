/**
 * positions.test.ts — unit tests for the resume data layer.
 *
 * expo-sqlite has no Node runtime, so we jest.mock('../../data/db') with a
 * better-sqlite3-backed fake implementing the exact SDK 58 surface the
 * production code uses (getFirstAsync/getAllAsync/runAsync, positional `?`
 * params). The REAL SQL consts from positions.ts execute against a real
 * SQLite engine (3.53, STRICT-capable), so this tests the actual SQL logic —
 * not just the query strings — plus the prune math as an explicit const
 * shape assertion.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

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
      const info = raw.prepare(sql).run(toArray(params));
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowId),
      });
    },
  };

  return {
    getDb: () => Promise.resolve(fake as unknown as SQLiteDatabase),
    withTransaction: <T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> =>
      task(fake as unknown as SQLiteDatabase),
    closeDb: () => Promise.resolve(),
    __resetTables: () => {
      raw.exec('DELETE FROM reading_position; DELETE FROM position_history;');
    },
  };
});

import {
  HISTORY_KEEP,
  SQL_PRUNE_HISTORY,
  clearPosition,
  getHistory,
  getPosition,
  pushHistory,
  savePosition,
  type SavedPosition,
} from '../positions';

const mockDb = jest.requireMock('../../data/db') as {
  __resetTables: () => void;
};

const pos = (overrides: Partial<SavedPosition> = {}): SavedPosition => ({
  page: 124,
  line_index: 7,
  y_norm: 0.42,
  snippet: 'the quick brown fox jumps over',
  ruler_enabled: 1,
  ...overrides,
});

beforeEach(() => {
  mockDb.__resetTables();
});

describe('getPosition / savePosition', () => {
  test('returns null when nothing saved', async () => {
    await expect(getPosition('book-1')).resolves.toBeNull();
  });

  test('save + get round-trips all fields', async () => {
    const p = pos();
    await savePosition('book-1', p);
    const got = await getPosition('book-1');
    expect(got).toEqual(p);
  });

  test('save overwrites (INSERT OR REPLACE), one row per book', async () => {
    await savePosition('book-1', pos({ page: 10 }));
    await savePosition('book-1', pos({ page: 20, snippet: 'later line' }));
    const got = await getPosition('book-1');
    expect(got?.page).toBe(20);
    expect(got?.snippet).toBe('later line');
  });

  test('updated_at is stamped and refreshed on re-save', async () => {
    const { getDb } = jest.requireMock('../../data/db') as {
      getDb: () => Promise<SQLiteDatabase>;
    };
    const db = await getDb();
    await savePosition('book-1', pos());
    const first = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM reading_position WHERE book_id = ?',
      ['book-1'],
    );
    expect(first).not.toBeNull();
    expect(typeof first!.updated_at).toBe('number');
    // Busy-wait past the ms boundary so the stamp must increase.
    const target = first!.updated_at + 1;
    while (Date.now() < target) {
      /* spin */
    }
    await savePosition('book-1', pos());
    const second = await db.getFirstAsync<{ updated_at: number }>(
      'SELECT updated_at FROM reading_position WHERE book_id = ?',
      ['book-1'],
    );
    expect(second!.updated_at).toBeGreaterThan(first!.updated_at);
  });

  test('positions are per-book', async () => {
    await savePosition('book-1', pos({ page: 5 }));
    await savePosition('book-2', pos({ page: 9 }));
    expect((await getPosition('book-1'))?.page).toBe(5);
    expect((await getPosition('book-2'))?.page).toBe(9);
  });
});

describe('pushHistory / getHistory (keep last 20)', () => {
  test(`keeps only the newest ${HISTORY_KEEP} rows per book`, async () => {
    for (let page = 1; page <= 25; page++) {
      await pushHistory('book-1', pos({ page, snippet: `line on page ${page}` }));
    }
    const history = await getHistory('book-1');
    expect(history).toHaveLength(HISTORY_KEEP);
    // Newest first: pages 25..6 survive, 1..5 pruned.
    expect(history[0].page).toBe(25);
    expect(history[history.length - 1].page).toBe(6);
    expect(history.map((h) => h.page)).not.toContain(5);
  });

  test('history is per-book; pruning one book leaves another intact', async () => {
    for (let page = 1; page <= 25; page++) {
      await pushHistory('book-1', pos({ page }));
    }
    await pushHistory('book-2', pos({ page: 3 }));
    await pushHistory('book-2', pos({ page: 4 }));
    expect(await getHistory('book-1')).toHaveLength(HISTORY_KEEP);
    const b2 = await getHistory('book-2');
    expect(b2.map((h) => h.page)).toEqual([4, 3]);
  });

  test('getHistory returns newest-first', async () => {
    await pushHistory('book-1', pos({ page: 10 }));
    await pushHistory('book-1', pos({ page: 11 }));
    const history = await getHistory('book-1');
    expect(history.map((h) => h.page)).toEqual([11, 10]);
  });

  test('getHistory is empty for a fresh book', async () => {
    await expect(getHistory('book-1')).resolves.toEqual([]);
  });
});

describe('prune SQL', () => {
  test('prune const deletes by NOT IN (SELECT ... LIMIT n)', () => {
    // Per the spec: keep-last-20 → DELETE WHERE id NOT IN (SELECT id ... LIMIT 20).
    expect(SQL_PRUNE_HISTORY).toMatch(/DELETE\s+FROM\s+position_history/i);
    expect(SQL_PRUNE_HISTORY).toMatch(/id\s+NOT\s+IN\s*\(/i);
    expect(SQL_PRUNE_HISTORY).toMatch(/SELECT\s+id\s+FROM\s+position_history/i);
    expect(SQL_PRUNE_HISTORY).toMatch(/ORDER\s+BY\s+at\s+DESC/i);
    expect(SQL_PRUNE_HISTORY).toMatch(/LIMIT\s+\?/i);
    expect(HISTORY_KEEP).toBe(20);
  });
});

describe('clearPosition', () => {
  test('removes the saved position and the jump-back history', async () => {
    await savePosition('book-1', pos());
    await pushHistory('book-1', pos({ page: 100 }));
    await pushHistory('book-1', pos({ page: 101 }));
    await clearPosition('book-1');

    await expect(getPosition('book-1')).resolves.toBeNull();
    await expect(getHistory('book-1')).resolves.toEqual([]);
  });

  test('does not touch other books', async () => {
    await savePosition('book-1', pos());
    await savePosition('book-2', pos({ page: 50 }));
    await clearPosition('book-1');
    expect((await getPosition('book-2'))?.page).toBe(50);
  });
});
