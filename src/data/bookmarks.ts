/**
 * bookmarks.ts — expo-sqlite data layer for page bookmarks (M5, PRD §6.9).
 *
 * Table (see src/data/schema.ts):
 * - `bookmarks(id, book_id, page, label, created_at)` — page-level bookmarks.
 *
 * Same pattern as positions.ts: exported SQL consts, unit-testable in Node
 * via a jest.mock of ../../data/db (see search/__tests__ for the harness).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, withTransaction } from './db';

export interface Bookmark {
  id: number;
  book_id: string;
  page: number;
  label: string | null;
  created_at: number;
}

/* ---------------- exported SQL (unit-tested as consts) ---------------- */

export const SQL_LIST_BOOKMARKS = `
  SELECT id, book_id, page, label, created_at
  FROM bookmarks
  WHERE book_id = ?
  ORDER BY page ASC, id ASC
`;

export const SQL_ADD_BOOKMARK = `
  INSERT INTO bookmarks (book_id, page, label, created_at)
  VALUES (?, ?, ?, ?)
`;

export const SQL_REMOVE_BOOKMARK = `
  DELETE FROM bookmarks WHERE id = ? AND book_id = ?
`;

export const SQL_FIND_BOOKMARK_AT_PAGE = `
  SELECT id FROM bookmarks WHERE book_id = ? AND page = ? LIMIT 1
`;

/** All bookmarks for a book, in page order. */
export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const db = await getDb();
  return db.getAllAsync<Bookmark>(SQL_LIST_BOOKMARKS, [bookId]);
}

/** Add a page-level bookmark. Returns the new row id. */
export async function addBookmark(
  bookId: string,
  page: number,
  label: string | null = null,
): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(SQL_ADD_BOOKMARK, [bookId, page, label, Date.now()]);
  return res.lastInsertRowId;
}

/** Remove a bookmark by id. */
export async function removeBookmark(bookId: string, id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(SQL_REMOVE_BOOKMARK, [id, bookId]);
}

/**
 * Toggle a bookmark at a page: removes it if one exists there, else adds
 * one (label defaults to null → UI renders `p.N`). Returns true when a
 * bookmark is now present at the page.
 */
export async function toggleBookmarkAtPage(bookId: string, page: number): Promise<boolean> {
  return withTransaction(async (db: SQLiteDatabase) => {
    const existing = await db.getFirstAsync<{ id: number }>(SQL_FIND_BOOKMARK_AT_PAGE, [
      bookId,
      page,
    ]);
    if (existing) {
      await db.runAsync(SQL_REMOVE_BOOKMARK, [existing.id, bookId]);
      return false;
    }
    await db.runAsync(SQL_ADD_BOOKMARK, [bookId, page, null, Date.now()]);
    return true;
  });
}

/** True when any bookmark exists at the page (for the chrome bookmark icon). */
export async function hasBookmarkAtPage(bookId: string, page: number): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: number }>(SQL_FIND_BOOKMARK_AT_PAGE, [bookId, page]);
  return row != null;
}
