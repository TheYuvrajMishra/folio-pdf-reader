/**
 * bookmarks.test.ts — bookmark repository against a real SQLite engine (M5).
 *
 * Same better-sqlite3 harness as the search/positions tests.
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
      };
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowid ?? 0),
      });
    },
    withTransactionAsync: (task: (db: unknown) => Promise<unknown>) => task(fake),
  };

  return {
    getDb: () => Promise.resolve(fake),
    withTransaction: <T>(task: (db: unknown) => Promise<T>): Promise<T> => task(fake),
    closeDb: () => Promise.resolve(),
    __clear: () => {
      raw.exec('DELETE FROM bookmarks;');
    },
  };
});

import {
  addBookmark,
  hasBookmarkAtPage,
  listBookmarks,
  removeBookmark,
  toggleBookmarkAtPage,
} from '../bookmarks';

const mockDb = jest.requireMock('../../data/db') as { __clear: () => void };

beforeEach(() => mockDb.__clear());

describe('bookmarks', () => {
  test('add + list in page order', async () => {
    await addBookmark('b1', 30);
    await addBookmark('b1', 5, 'intro');
    await addBookmark('b2', 5);
    const rows = await listBookmarks('b1');
    expect(rows.map((r) => r.page)).toEqual([5, 30]);
    expect(rows[0].label).toBe('intro');
    expect(rows[1].label).toBeNull();
  });

  test('remove deletes the row', async () => {
    const id = await addBookmark('b1', 10);
    await removeBookmark('b1', id);
    await expect(listBookmarks('b1')).resolves.toEqual([]);
  });

  test('toggle adds then removes at the same page', async () => {
    await expect(toggleBookmarkAtPage('b1', 42)).resolves.toBe(true);
    await expect(hasBookmarkAtPage('b1', 42)).resolves.toBe(true);
    await expect(toggleBookmarkAtPage('b1', 42)).resolves.toBe(false);
    await expect(hasBookmarkAtPage('b1', 42)).resolves.toBe(false);
  });

  test('toggle does not touch other pages', async () => {
    await toggleBookmarkAtPage('b1', 7);
    await toggleBookmarkAtPage('b1', 9);
    await toggleBookmarkAtPage('b1', 7);
    const rows = await listBookmarks('b1');
    expect(rows.map((r) => r.page)).toEqual([9]);
  });
});
