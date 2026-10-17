/**
 * search.ts — full-text search over the per-page FTS5 index (M5, PRD §6.9).
 *
 * The indexer writes one row per page into the `page_text` FTS5 table
 * (see src/data/schema.ts): `page_text(book_id UNINDEXED, page UNINDEXED, text)`.
 *
 * - `escapeFts5Query`: turns raw user input into a safe FTS5 MATCH expression.
 *   Every whitespace-separated token is double-quoted (internal `"` doubled)
 *   and tokens are AND-ed, so FTS5 syntax characters (`"`, `*`, `:`, `AND`,
 *   `OR`, `NOT`, `^`, …) can never change the query shape or throw.
 * - `searchBook`: MATCH + `snippet()` with private-use sentinels
 *   (\uE000 … \uE001) marking each hit; `parseSnippet` splits a snippet into
 *   plain/match segments for the ember-highlighted UI (DESIGN §6.6).
 * - Capped at 100 results.
 *
 * Platform note: follows the positions.ts pattern — SQL consts are exported
 * and unit-tested against better-sqlite3 via a jest.mock of ../../data/db.
 */

import { getDb } from '../data/db';

/** Sentinel markers wrapping each match inside a snippet (U+E000 / U+E001). */
export const SNIPPET_START = '';
export const SNIPPET_END = '';

export interface SearchResult {
  /** 1-based page number. */
  page: number;
  /** Snippet with SNIPPET_START/END wrapping each match. */
  snippet: string;
}

export interface SnippetSegment {
  text: string;
  match: boolean;
}

/* ---------------- exported SQL (unit-tested as consts) ---------------- */

export const SQL_SEARCH = `
  SELECT page, snippet(page_text, -1, ?, ?, '…', 10) AS snippet
  FROM page_text
  WHERE book_id = ? AND page_text MATCH ?
  ORDER BY rank
  LIMIT 100
`;

/**
 * Escape raw user input into a safe FTS5 MATCH expression.
 * Returns '' for blank input (callers should skip the query then).
 */
export function escapeFts5Query(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' AND ');
}

/** Split a snippet into plain/match segments on the sentinel markers. */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const segments: SnippetSegment[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(SNIPPET_START);
    if (start === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), match: false });
    const after = rest.slice(start + SNIPPET_START.length);
    const end = after.indexOf(SNIPPET_END);
    if (end === -1) {
      // Unbalanced marker: treat the tail as plain text.
      segments.push({ text: after, match: false });
      break;
    }
    segments.push({ text: after.slice(0, end), match: true });
    rest = after.slice(end + SNIPPET_END.length);
  }
  return segments;
}

/**
 * Search one book's page text. Returns up to 100 {page, snippet} rows,
 * ranked by FTS5 bm25. Never throws on hostile input — syntax characters
 * are neutralized by escapeFts5Query.
 */
export async function searchBook(bookId: string, query: string): Promise<SearchResult[]> {
  const match = escapeFts5Query(query);
  if (!match) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<{ page: number; snippet: string }>(SQL_SEARCH, [
    SNIPPET_START,
    SNIPPET_END,
    bookId,
    match,
  ]);
  return rows.map((r) => ({ page: r.page, snippet: r.snippet ?? '' }));
}
