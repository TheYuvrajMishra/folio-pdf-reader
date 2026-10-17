/**
 * search.test.ts — FTS5 search against a real SQLite engine (better-sqlite3),
 * plus the escaping + snippet-segment helpers (M5).
 *
 * Same harness shape as positions.test.ts: jest.mock('../../data/db') with a
 * better-sqlite3-backed fake exposing the SDK 58 surface (getFirstAsync /
 * getAllAsync / runAsync, positional `?` params). The REAL SQL consts from
 * search.ts execute against SQLite 3.53 with FTS5.
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
      const info = raw.prepare(sql).run(toArray(params));
      return Promise.resolve({
        changes: info.changes,
        lastInsertRowId: Number(info.lastInsertRowId),
      });
    },
  };

  return {
    getDb: () => Promise.resolve(fake),
    withTransaction: <T>(task: (db: unknown) => Promise<T>): Promise<T> => task(fake),
    closeDb: () => Promise.resolve(),
    __seed: (bookId: string, pages: Array<[number, string]>) => {
      const ins = raw.prepare('INSERT INTO page_text (book_id, page, text) VALUES (?, ?, ?)');
      for (const [page, text] of pages) ins.run(bookId, page, text);
    },
    __clear: () => {
      raw.exec('DELETE FROM page_text;');
    },
  };
});

import type { SQLiteDatabase } from 'expo-sqlite';
import {
  SNIPPET_END,
  SNIPPET_START,
  escapeFts5Query,
  parseSnippet,
  searchBook,
} from '../search';

const mockDb = jest.requireMock('../../data/db') as {
  __seed: (bookId: string, pages: Array<[number, string]>) => void;
  __clear: () => void;
};

beforeEach(() => {
  mockDb.__clear();
  mockDb.__seed('b1', [
    [1, 'the quick brown fox jumps over the lazy dog'],
    [2, 'a second page about the fox and hounds'],
    [3, 'nothing relevant here at all'],
    [4, 'the fox returns in chapter four'],
  ]);
  mockDb.__seed('b2', [[1, 'another book mentions a fox as well']]);
});

describe('escapeFts5Query', () => {
  test('blank input escapes to empty', () => {
    expect(escapeFts5Query('')).toBe('');
    expect(escapeFts5Query('   ')).toBe('');
  });

  test('tokens are quoted and AND-ed', () => {
    expect(escapeFts5Query('quick fox')).toBe('"quick" AND "fox"');
  });

  test('double quotes inside tokens are doubled, never break the query', () => {
    expect(escapeFts5Query('say "hi"')).toBe('"say" AND """hi"""');
  });

  test('FTS5 operator words become inert quoted phrases', () => {
    // "AND OR NOT" as raw input must not act as boolean operators.
    expect(escapeFts5Query('AND OR NOT')).toBe('"AND" AND "OR" AND "NOT"');
  });

  test('special chars (* : ^) are neutralized inside quotes', () => {
    expect(escapeFts5Query('foo* bar:baz^2')).toBe('"foo*" AND "bar:baz^2"');
  });
});

describe('searchBook', () => {
  test('finds matching pages with sentinel-marked snippets', async () => {
    const res = await searchBook('b1', 'fox');
    expect(res.length).toBe(3);
    const pages = res.map((r) => r.page).sort();
    expect(pages).toEqual([1, 2, 4]);
    for (const r of res) {
      expect(r.snippet).toContain(SNIPPET_START);
      expect(r.snippet).toContain(SNIPPET_END);
    }
    const p1 = res.find((r) => r.page === 1)!;
    expect(p1.snippet).toContain(`${SNIPPET_START}fox${SNIPPET_END}`);
  });

  test('multi-word query requires all tokens', async () => {
    const res = await searchBook('b1', 'fox chapter');
    expect(res.map((r) => r.page)).toEqual([4]);
  });

  test('scoped to the book', async () => {
    const res = await searchBook('b2', 'fox');
    expect(res.map((r) => r.page)).toEqual([1]);
  });

  test('blank query returns [] without hitting the DB', async () => {
    await expect(searchBook('b1', '   ')).resolves.toEqual([]);
  });

  test('hostile input cannot throw a syntax error', async () => {
    // Would be "unterminated string" / syntax errors if interpolated raw.
    await expect(searchBook('b1', '"')).resolves.toEqual([]);
    await expect(searchBook('b1', 'AND OR NOT * : ^ "unbalanced')).resolves.toEqual([]);
  });

  test('no matches returns []', async () => {
    await expect(searchBook('b1', 'zebra')).resolves.toEqual([]);
  });

  test('caps at 100 rows', async () => {
    const many: Array<[number, string]> = [];
    for (let p = 1; p <= 150; p++) many.push([p, `page mentions needle ${p}`]);
    mockDb.__seed('big', many);
    const res = await searchBook('big', 'needle');
    expect(res.length).toBe(100);
  });
});

describe('parseSnippet', () => {
  test('splits plain and match segments', () => {
    const segs = parseSnippet(`the ${SNIPPET_START}quick${SNIPPET_END} brown`);
    expect(segs).toEqual([
      { text: 'the ', match: false },
      { text: 'quick', match: true },
      { text: ' brown', match: false },
    ]);
  });

  test('multiple matches', () => {
    const segs = parseSnippet(
      `${SNIPPET_START}fox${SNIPPET_END} and ${SNIPPET_START}fox${SNIPPET_END}`,
    );
    expect(segs.filter((s) => s.match).map((s) => s.text)).toEqual(['fox', 'fox']);
  });

  test('plain snippet with no markers', () => {
    expect(parseSnippet('just text')).toEqual([{ text: 'just text', match: false }]);
  });

  test('empty snippet', () => {
    expect(parseSnippet('')).toEqual([]);
  });
});
