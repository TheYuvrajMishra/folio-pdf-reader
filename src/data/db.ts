/**
 * SQLite data layer (PRD §7.6). WAL on, versioned migrations via
 * PRAGMA user_version. SQLite is the source of truth; zustand holds UI
 * state only. Every user-action write happens in one transaction.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'folio.db';
/** Bump when migrations change. */
const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS: string[] = [
  /* v1 — full v1.0 schema (PRD §7.6) */
  `
  CREATE TABLE IF NOT EXISTS books(
    id TEXT PRIMARY KEY, title TEXT, author TEXT, file_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL, page_count INTEGER NOT NULL, cover_path TEXT,
    hash TEXT, added_at INTEGER NOT NULL, last_opened_at INTEGER,
    indexed_pages INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS reading_position(
    book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, line_index INTEGER NOT NULL DEFAULT 0,
    y_norm REAL NOT NULL DEFAULT 0, snippet TEXT NOT NULL DEFAULT '',
    ruler_enabled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS position_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, line_index INTEGER NOT NULL, y_norm REAL NOT NULL,
    snippet TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_position_history_book ON position_history(book_id, at DESC);
  CREATE TABLE IF NOT EXISTS page_lines(
    book_id TEXT NOT NULL, page INTEGER NOT NULL, idx INTEGER NOT NULL,
    x0 REAL NOT NULL, y0 REAL NOT NULL, x1 REAL NOT NULL, y1 REAL NOT NULL,
    text TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'body',
    PRIMARY KEY(book_id, page, idx)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS page_text USING fts5(
    book_id UNINDEXED, page UNINDEXED, text
  );
  CREATE TABLE IF NOT EXISTS annotations(
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, type TEXT NOT NULL, color TEXT NOT NULL,
    opacity REAL NOT NULL DEFAULT 1, data_json TEXT NOT NULL, note TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_annotations_book_page ON annotations(book_id, page);
  CREATE TABLE IF NOT EXISTS annotation_ops(
    id INTEGER PRIMARY KEY AUTOINCREMENT, book_id TEXT NOT NULL,
    seq INTEGER NOT NULL, op_type TEXT NOT NULL, annotation_id TEXT NOT NULL,
    before_json TEXT, after_json TEXT, undone INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_book_seq ON annotation_ops(book_id, seq);
  CREATE TABLE IF NOT EXISTS bookmarks(
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    page INTEGER NOT NULL, label TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
    started_at INTEGER NOT NULL, ended_at INTEGER, pages_read INTEGER NOT NULL DEFAULT 0,
    active_seconds INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
  `,
];

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode=WAL;');
  await db.execAsync('PRAGMA foreign_keys=ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current < SCHEMA_VERSION) {
    await db.withTransactionAsync(async () => {
      for (let v = current; v < SCHEMA_VERSION; v++) {
        await db.execAsync(MIGRATIONS[v]);
      }
      await db.execAsync(`PRAGMA user_version=${SCHEMA_VERSION};`);
    });
  }
  return db;
}

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

/** Test/maintenance hook: close and drop the cached handle. */
export function __resetDbForTests(): void {
  dbPromise = null;
}
