/**
 * settings.test.ts — unit tests for the typed settings layer.
 *
 * expo-sqlite has no Node runtime, so we jest.mock('../db') with a
 * better-sqlite3-backed fake implementing the exact SDK 58 surface the
 * production code uses (getFirstAsync/runAsync, positional `?` params). The
 * REAL SQL consts from settings.ts execute against a real SQLite engine, so
 * this tests the actual SQL logic — upsert, missing keys, corrupt JSON — not
 * just the query strings.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

jest.mock('../db', () => {
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SCHEMA_STATEMENTS_V1 } = require('../schema');
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
      raw.exec('DELETE FROM settings;');
    },
  };
});

import {
  DEFAULT_ANIMATION_DOWNGRADED,
  DEFAULT_PAGE_ANIMATION,
  SETTINGS_KEYS,
  SQL_GET_SETTING,
  SQL_SET_SETTING,
  getSetting,
  setSetting,
} from '../settings';

const mockDb = jest.requireMock('../db') as { __resetTables: () => void };

beforeEach(() => {
  mockDb.__resetTables();
});

describe('settings keys and defaults', () => {
  test('page_animation defaults to curl', () => {
    expect(SETTINGS_KEYS.PAGE_ANIMATION).toBe('page_animation');
    expect(DEFAULT_PAGE_ANIMATION).toBe('curl');
  });

  test('animation_downgraded defaults to false', () => {
    expect(SETTINGS_KEYS.ANIMATION_DOWNGRADED).toBe('animation_downgraded');
    expect(DEFAULT_ANIMATION_DOWNGRADED).toBe(false);
  });
});

describe('SQL consts', () => {
  test('GET selects value_json by key', () => {
    expect(SQL_GET_SETTING).toMatch(/FROM settings/i);
    expect(SQL_GET_SETTING).toMatch(/WHERE key = \?/);
    expect(SQL_GET_SETTING).toMatch(/value_json/i);
  });

  test('SET upserts on key conflict', () => {
    expect(SQL_SET_SETTING).toMatch(/INSERT INTO settings/i);
    expect(SQL_SET_SETTING).toMatch(/ON CONFLICT\(key\) DO UPDATE/i);
  });
});

describe('getSetting / setSetting', () => {
  test('missing key → fallback', async () => {
    await expect(
      getSetting(SETTINGS_KEYS.PAGE_ANIMATION, DEFAULT_PAGE_ANIMATION),
    ).resolves.toBe('curl');
  });

  test('round-trips the animation style', async () => {
    await setSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'slide');
    await expect(
      getSetting(SETTINGS_KEYS.PAGE_ANIMATION, DEFAULT_PAGE_ANIMATION),
    ).resolves.toBe('slide');
  });

  test('round-trips the downgrade latch boolean', async () => {
    await setSetting(SETTINGS_KEYS.ANIMATION_DOWNGRADED, true);
    await expect(
      getSetting(SETTINGS_KEYS.ANIMATION_DOWNGRADED, DEFAULT_ANIMATION_DOWNGRADED),
    ).resolves.toBe(true);
  });

  test('upsert overwrites the previous value', async () => {
    await setSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'curl');
    await setSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'fade');
    await expect(
      getSetting(SETTINGS_KEYS.PAGE_ANIMATION, DEFAULT_PAGE_ANIMATION),
    ).resolves.toBe('fade');
  });

  test('corrupt JSON → fallback', async () => {
    // Bypass setSetting to plant a non-JSON value.
    const { getDb } = jest.requireMock('../db') as {
      getDb: () => Promise<SQLiteDatabase>;
    };
    const db = await getDb();
    await db.runAsync(
      'INSERT INTO settings (key, value_json) VALUES (?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      [SETTINGS_KEYS.PAGE_ANIMATION, 'not-json{{{'],
    );
    await expect(
      getSetting(SETTINGS_KEYS.PAGE_ANIMATION, DEFAULT_PAGE_ANIMATION),
    ).resolves.toBe('curl');
  });

  test('settings for different keys are independent', async () => {
    await setSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'none');
    await setSetting(SETTINGS_KEYS.ANIMATION_DOWNGRADED, true);
    await expect(
      getSetting(SETTINGS_KEYS.PAGE_ANIMATION, DEFAULT_PAGE_ANIMATION),
    ).resolves.toBe('none');
    await expect(
      getSetting(SETTINGS_KEYS.ANIMATION_DOWNGRADED, DEFAULT_ANIMATION_DOWNGRADED),
    ).resolves.toBe(true);
  });
});
