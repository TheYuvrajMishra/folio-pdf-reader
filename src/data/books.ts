/**
 * books.ts — repository over the `books` table (PRD §7.6).
 *
 * Timestamps are unix-epoch milliseconds. Soft delete via `deleted_at`;
 * list/get never return soft-deleted rows. Multi-statement writes go through
 * `withTransaction` (see db.ts); single-statement writes don't need it.
 *
 * Sorting is done with pure comparators (exported for unit tests) so the
 * ordering rules stay testable without a database.
 */

import { getDb } from './db';
import { clearPosition } from './positions';

/** Library sort orders (DESIGN §6.1). */
export type BookSort = 'recent' | 'title' | 'progress';

/** A book row, camelCase. Mirrors the `books` table columns 1:1. */
export interface Book {
  id: string;
  title: string;
  author: string | null;
  filePath: string;
  sizeBytes: number | null;
  pageCount: number | null;
  coverPath: string | null;
  hash: string | null;
  addedAt: number;
  lastOpenedAt: number | null;
  indexedPages: number;
  deletedAt: number | null;
}

/** Fields accepted by insertBook. `id` is a UUID v4 (see src/library/uuid.ts). */
export interface InsertBookInput {
  id: string;
  title: string;
  author?: string | null;
  filePath: string;
  sizeBytes?: number | null;
  pageCount?: number | null;
  coverPath?: string | null;
  hash?: string | null;
  addedAt?: number;
  lastOpenedAt?: number | null;
  indexedPages?: number;
}

/** Writable book fields (updateBook / rename flows). */
export type BookPatch = Partial<
  Pick<
    Book,
    | 'title'
    | 'author'
    | 'filePath'
    | 'sizeBytes'
    | 'pageCount'
    | 'coverPath'
    | 'hash'
    | 'addedAt'
    | 'lastOpenedAt'
    | 'indexedPages'
    | 'deletedAt'
  >
>;

/** Raw snake_case row as returned by expo-sqlite. */
interface BookRow {
  id: string;
  title: string;
  author: string | null;
  file_path: string;
  size_bytes: number | null;
  page_count: number | null;
  cover_path: string | null;
  hash: string | null;
  added_at: number;
  last_opened_at: number | null;
  indexed_pages: number;
  deleted_at: number | null;
}

function bookFromRow(row: BookRow): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
    coverPath: row.cover_path,
    hash: row.hash,
    addedAt: row.added_at,
    lastOpenedAt: row.last_opened_at,
    indexedPages: row.indexed_pages,
    deletedAt: row.deleted_at,
  };
}

/** Recency key: last opened, falling back to when the book was added. */
function recencyKey(b: Book): number {
  return b.lastOpenedAt ?? b.addedAt ?? 0;
}

/**
 * Pure sort comparator for the library shelf.
 *
 * - recent: most recently opened first (never-opened fall back to added_at).
 * - title: case-insensitive A→Z, ties broken by recency.
 * - progress: per the M1-A contract this equals last_opened_at (a position
 *   join is deferred to a later milestone); never-opened books sort last.
 */
export function compareBooks(a: Book, b: Book, sort: BookSort): number {
  switch (sort) {
    case 'title': {
      const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      return byTitle !== 0 ? byTitle : recencyKey(b) - recencyKey(a);
    }
    case 'progress': {
      const ka = a.lastOpenedAt ?? -1;
      const kb = b.lastOpenedAt ?? -1;
      return kb - ka;
    }
    case 'recent':
    default:
      return recencyKey(b) - recencyKey(a);
  }
}

/** All non-deleted books, sorted. */
export async function listBooks(sort: BookSort = 'recent'): Promise<Book[]> {
  const db = await getDb();
  const rows = db.getAllSync<BookRow>('SELECT * FROM books WHERE deleted_at IS NULL');
  return rows.map(bookFromRow).sort((a, b) => compareBooks(a, b, sort));
}

/** One non-deleted book by id, or null. */
export async function getBook(id: string): Promise<Book | null> {
  const db = await getDb();
  const row = db.getFirstSync<BookRow>(
    'SELECT * FROM books WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  return row ? bookFromRow(row) : null;
}

/** Non-deleted book with this duplicate-detection hash, or null. */
export async function getBookByHash(hash: string): Promise<Book | null> {
  const db = await getDb();
  const row = db.getFirstSync<BookRow>(
    'SELECT * FROM books WHERE hash = ? AND deleted_at IS NULL',
    [hash],
  );
  return row ? bookFromRow(row) : null;
}

/** Insert a new book row. */
export async function insertBook(input: InsertBookInput): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  db.runSync(
    `INSERT INTO books
       (id, title, author, file_path, size_bytes, page_count, cover_path, hash,
        added_at, last_opened_at, indexed_pages, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      input.id,
      input.title,
      input.author ?? null,
      input.filePath,
      input.sizeBytes ?? null,
      input.pageCount ?? null,
      input.coverPath ?? null,
      input.hash ?? null,
      input.addedAt ?? now,
      input.lastOpenedAt ?? null,
      input.indexedPages ?? 0,
    ],
  );
}

const PATCH_COLUMNS: Record<keyof BookPatch, string> = {
  title: 'title',
  author: 'author',
  filePath: 'file_path',
  sizeBytes: 'size_bytes',
  pageCount: 'page_count',
  coverPath: 'cover_path',
  hash: 'hash',
  addedAt: 'added_at',
  lastOpenedAt: 'last_opened_at',
  indexedPages: 'indexed_pages',
  deletedAt: 'deleted_at',
};

/** Patch any subset of writable fields (incl. deletedAt for undo). No-op on {}. */
export async function updateBook(id: string, patch: BookPatch): Promise<void> {
  const keys = Object.keys(patch) as (keyof BookPatch)[];
  if (keys.length === 0) {
    return;
  }
  const db = await getDb();
  const set = keys.map((key) => `${PATCH_COLUMNS[key]} = ?`).join(', ');
  const values: (string | number | null)[] = keys.map((key) => patch[key] ?? null);
  db.runSync(`UPDATE books SET ${set} WHERE id = ?`, [...values, id]);
}

/** Soft delete: hides the book from the library; rows are kept for undo. */
export async function softDeleteBook(id: string): Promise<void> {
  const db = await getDb();
  db.runSync('UPDATE books SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [
    Date.now(),
    id,
  ]);
}

/** Rename a book (long-press menu). */
export async function renameBook(id: string, title: string): Promise<void> {
  await updateBook(id, { title });
}

/**
 * Reset reading progress: deletes the saved reading position and its history
 * for this book. Delegates to the resume agent's `clearPosition`
 * (src/data/positions.ts), which runs both deletes in one transaction.
 */
export async function resetProgress(id: string): Promise<void> {
  await clearPosition(id);
}

/** Mark the book as just opened (drives the "recent" sort + continue hero). */
export async function touchBook(id: string): Promise<void> {
  const db = await getDb();
  db.runSync('UPDATE books SET last_opened_at = ? WHERE id = ?', [Date.now(), id]);
}
