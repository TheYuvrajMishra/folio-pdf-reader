/**
 * rulerSettings.test.ts — unit tests for ruler settings persistence.
 *
 * Follows the positions.test.ts pattern: jest.mock('../../data/db') with a
 * better-sqlite3-backed fake implementing the SDK 58 surface, running the
 * REAL schema DDL + the module's actual SQL.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
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
    runAsync: (sql: string, params?: unknown) => {
      const info = raw.prepare(sql).run(toArray(params));
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowId),
      });
    },
  };

  return {
    getDb: () => Promise.resolve(fake),
    __reset: () => raw.exec('DELETE FROM settings;'),
  };
});

import type { SQLiteDatabase } from 'expo-sqlite';
import {
  DEFAULT_RULER_SETTINGS,
  getRulerSettings,
  sanitizeRulerSettings,
  setRulerSettings,
} from '../rulerSettings';

const mockDb = jest.requireMock('../../data/db') as {
  __reset: () => void;
  getDb: () => Promise<SQLiteDatabase>;
};

beforeEach(() => {
  mockDb.__reset();
});

describe('getRulerSettings', () => {
  test('returns defaults when no row exists', async () => {
    await expect(getRulerSettings()).resolves.toEqual(DEFAULT_RULER_SETTINGS);
  });

  test('returns defaults on corrupt JSON', async () => {
    const db = await mockDb.getDb();
    await db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value_json) VALUES ('ruler.settings', 'not-json{{{')",
    );
    await expect(getRulerSettings()).resolves.toEqual(DEFAULT_RULER_SETTINGS);
  });
});

describe('setRulerSettings', () => {
  test('round-trips a partial update', async () => {
    await setRulerSettings({ lines: 3, color: '#FF0000', glide: false });
    const s = await getRulerSettings();
    expect(s).toMatchObject({
      lines: 3,
      color: '#FF0000',
      glide: false,
      opacity: DEFAULT_RULER_SETTINGS.opacity,
    });
  });

  test('second update merges over the first', async () => {
    await setRulerSettings({ lines: 2 });
    await setRulerSettings({ haptics: false });
    const s = await getRulerSettings();
    expect(s.lines).toBe(2);
    expect(s.haptics).toBe(false);
  });

  test('invalid values are clamped, never stored raw', async () => {
    const s = await setRulerSettings({
      lines: 9 as unknown as 3,
      opacity: 5,
      color: 'not-a-color',
      padding: -1,
    });
    expect(s.lines).toBe(1);
    expect(s.opacity).toBe(1);
    expect(s.color).toBe(DEFAULT_RULER_SETTINGS.color);
    expect(s.padding).toBe(0);
  });
});

describe('sanitizeRulerSettings', () => {
  test('passes valid settings through', () => {
    const full = { ...DEFAULT_RULER_SETTINGS, lines: 2 as const, style: 'underline' as const };
    expect(sanitizeRulerSettings(full)).toEqual(full);
  });

  test('fills partial input with defaults', () => {
    expect(sanitizeRulerSettings({ lines: 3 })).toMatchObject({
      lines: 3,
      color: DEFAULT_RULER_SETTINGS.color,
    });
  });

  test('never throws on garbage', () => {
    expect(() => sanitizeRulerSettings(null)).not.toThrow();
    expect(() => sanitizeRulerSettings('x')).not.toThrow();
    expect(() => sanitizeRulerSettings(undefined)).not.toThrow();
    expect(sanitizeRulerSettings(null)).toEqual(DEFAULT_RULER_SETTINGS);
  });
});
