/**
 * positions.ts — expo-sqlite data layer for resume positions (PRD §6.4).
 *
 * Tables (see src/data/schema.ts):
 * - `reading_position` — one row per book: page, line_index, y_norm,
 *   snippet, ruler_enabled, updated_at.
 * - `position_history` — append-only log of recent positions per book;
 *   pruned to the last HISTORY_KEEP (= 20) rows per book → "Jump back" list.
 *
 * All multi-statement ops run inside `withTransaction` (src/data/db.ts).
 * Method names follow the expo-sqlite SDK 58 API:
 * getFirstAsync / getAllAsync / runAsync (+ withTransactionAsync).
 *
 * Platform note: importing this module is safe in Node (it only imports
 * db.ts, which defers the expo-sqlite dynamic import until getDb() runs).
 * Calling the functions in Node throws — see the unit tests, which
 * jest.mock('../../data/db') with a better-sqlite3-backed fake.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, withTransaction } from './db';

/** A saved reading position for one book (mirrors `reading_position`). */
export interface SavedPosition {
  /** 1-based page number. */
  page: number;
  line_index: number;
  /** 0..1, top-left origin (PRD §7.5). */
  y_norm: number;
  /** First ≤48 chars of the line, used to re-find it after re-indexing. */
  snippet: string;
  /** 0 | 1 — whether the reading ruler was enabled. */
  ruler_enabled: number;
}

/** "Jump back" list depth per book (PRD §6.4). */
export const HISTORY_KEEP = 20;

/* ---------------- exported SQL (unit-tested as consts) ---------------- */

export const SQL_GET_POSITION = `
  SELECT page, line_index, y_norm, snippet, ruler_enabled
  FROM reading_position
  WHERE book_id = ?
`;

export const SQL_SAVE_POSITION = `
  INSERT OR REPLACE INTO reading_position
    (book_id, page, line_index, y_norm, snippet, ruler_enabled, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const SQL_PUSH_HISTORY = `
  INSERT INTO position_history
    (book_id, page, line_index, y_norm, snippet, at)
  VALUES (?, ?, ?, ?, ?, ?)
`;

/**
 * Prune math, keep-last-N per book: delete every history row for the book
 * whose id is NOT among the N newest (by `at`, tie-broken by `id`).
 */
export const SQL_PRUNE_HISTORY = `
  DELETE FROM position_history
  WHERE book_id = ?
    AND id NOT IN (
      SELECT id FROM position_history
      WHERE book_id = ?
      ORDER BY at DESC, id DESC
      LIMIT ?
    )
`;

export const SQL_GET_HISTORY = `
  SELECT page, line_index, y_norm, snippet
  FROM position_history
  WHERE book_id = ?
  ORDER BY at DESC, id DESC
  LIMIT ?
`;

export const SQL_CLEAR_POSITION = `
  DELETE FROM reading_position WHERE book_id = ?
`;

export const SQL_CLEAR_HISTORY = `
  DELETE FROM position_history WHERE book_id = ?
`;

/* ---------------- row mapping ---------------- */

interface PositionRow {
  page: number;
  line_index: number;
  y_norm: number;
  snippet: string | null;
  ruler_enabled: number;
}

interface HistoryRow {
  page: number;
  line_index: number;
  y_norm: number;
  snippet: string | null;
}

function toSavedPosition(row: PositionRow): SavedPosition {
  return {
    page: row.page,
    line_index: row.line_index,
    y_norm: row.y_norm,
    snippet: row.snippet ?? '',
    ruler_enabled: row.ruler_enabled,
  };
}

function toHistoryPosition(row: HistoryRow): SavedPosition {
  return {
    page: row.page,
    line_index: row.line_index,
    y_norm: row.y_norm,
    snippet: row.snippet ?? '',
    // History rows predate the ruler flag; the reader treats them as
    // ruler-agnostic (it only needs page/line/y_norm to jump).
    ruler_enabled: 0,
  };
}

/* ---------------- public API ---------------- */

/** Load the saved position for a book, or null if never saved. */
export async function getPosition(bookId: string): Promise<SavedPosition | null> {
  const db: SQLiteDatabase = await getDb();
  const row = await db.getFirstAsync<PositionRow>(SQL_GET_POSITION, [bookId]);
  return row ? toSavedPosition(row) : null;
}

/** Save (insert or replace) the current position; stamps updated_at = now. */
export async function savePosition(bookId: string, p: SavedPosition): Promise<void> {
  const db: SQLiteDatabase = await getDb();
  await db.runAsync(SQL_SAVE_POSITION, [
    bookId,
    p.page,
    p.line_index,
    p.y_norm,
    p.snippet,
    p.ruler_enabled,
    Date.now(),
  ]);
}

/**
 * Append a position to the per-book history, then prune to the last
 * HISTORY_KEEP rows. Single transaction so the log never grows unbounded.
 */
export async function pushHistory(bookId: string, p: SavedPosition): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync(SQL_PUSH_HISTORY, [
      bookId,
      p.page,
      p.line_index,
      p.y_norm,
      p.snippet,
      Date.now(),
    ]);
    await db.runAsync(SQL_PRUNE_HISTORY, [bookId, bookId, HISTORY_KEEP]);
  });
}

/** Newest-first "Jump back" list (at most HISTORY_KEEP entries). */
export async function getHistory(bookId: string): Promise<SavedPosition[]> {
  const db: SQLiteDatabase = await getDb();
  const rows = await db.getAllAsync<HistoryRow>(SQL_GET_HISTORY, [bookId, HISTORY_KEEP]);
  return rows.map(toHistoryPosition);
}

/**
 * Forget a book's progress entirely: current position AND jump-back
 * history. Used by reset-progress (library long-press menu, PRD §6.1).
 */
export async function clearPosition(bookId: string): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync(SQL_CLEAR_POSITION, [bookId]);
    await db.runAsync(SQL_CLEAR_HISTORY, [bookId]);
  });
}
