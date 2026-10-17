/**
 * Folio SQLite schema — single source of truth for DDL.
 *
 * Source: PRD §7.6 (data model). Migration v1 creates everything here.
 * Timestamps are stored as INTEGER unix-epoch milliseconds.
 * Normalized coordinates are REAL in 0..1 (PRD §7.5).
 *
 * Notes:
 * - No PRAGMA foreign_keys enforcement: cascade deletes of a book are
 *   handled explicitly by the repositories (bulk DELETE per table is
 *   cheaper than per-row FK cascades).
 * - `page_text` is an EXTERNAL FTS5 table (no content= sync). The indexer
 *   writes it alongside `page_lines`; queries join on (book_id, page).
 *   book_id/page are UNINDEXED so they are stored but never tokenized.
 */

/** All DDL statements for schema version 1, in dependency-safe order. */
export const SCHEMA_STATEMENTS_V1: readonly string[] = [
  /* ---------------- books ---------------- */
  `CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    file_path TEXT NOT NULL,
    size_bytes INTEGER,
    page_count INTEGER,
    cover_path TEXT,
    hash TEXT,
    added_at INTEGER NOT NULL,
    last_opened_at INTEGER,
    indexed_pages INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  ) STRICT`,

  /* ---------------- reading_position ---------------- */
  `CREATE TABLE IF NOT EXISTS reading_position (
    book_id TEXT PRIMARY KEY,
    page INTEGER NOT NULL,
    line_index INTEGER NOT NULL,
    y_norm REAL NOT NULL,
    snippet TEXT,
    ruler_enabled INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  ) STRICT`,

  /* ---------------- position_history ---------------- */
  `CREATE TABLE IF NOT EXISTS position_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    line_index INTEGER,
    y_norm REAL,
    snippet TEXT,
    at INTEGER NOT NULL
  ) STRICT`,

  /* ---------------- page_lines ---------------- */
  `CREATE TABLE IF NOT EXISTS page_lines (
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    x0 REAL NOT NULL,
    y0 REAL NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'body',
    PRIMARY KEY (book_id, page, idx)
  ) STRICT`,

  /* ---------------- page_text (FTS5) ---------------- */
  `CREATE VIRTUAL TABLE IF NOT EXISTS page_text USING fts5(
    book_id UNINDEXED,
    page UNINDEXED,
    text
  )`,

  /* ---------------- annotations ---------------- */
  `CREATE TABLE IF NOT EXISTS annotations (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    type TEXT NOT NULL,
    color TEXT NOT NULL,
    opacity REAL NOT NULL DEFAULT 1.0,
    data_json TEXT NOT NULL,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  ) STRICT`,

  /* ---------------- annotation_ops (undo/redo log) ---------------- */
  `CREATE TABLE IF NOT EXISTS annotation_ops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    op_type TEXT NOT NULL,
    annotation_id TEXT,
    before_json TEXT,
    after_json TEXT,
    undone INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  ) STRICT`,

  /* ---------------- bookmarks ---------------- */
  `CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    label TEXT,
    created_at INTEGER NOT NULL
  ) STRICT`,

  /* ---------------- sessions ---------------- */
  `CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    pages_read INTEGER NOT NULL DEFAULT 0,
    active_seconds INTEGER NOT NULL DEFAULT 0
  ) STRICT`,

  /* ---------------- settings ---------------- */
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  ) STRICT`,

  /* ---------------- indexes ---------------- */
  // Ruler + resume: fetch one page's lines in order (covers ORDER BY idx).
  `CREATE INDEX IF NOT EXISTS idx_page_lines_book_page
    ON page_lines (book_id, page, idx)`,

  // Undo/redo: newest op / oldest undone op per book.
  `CREATE INDEX IF NOT EXISTS idx_annotation_ops_book_seq
    ON annotation_ops (book_id, seq)`,

  // Render: all live annotations on a page.
  `CREATE INDEX IF NOT EXISTS idx_annotations_book_page
    ON annotations (book_id, page)`,

  // Library sort by recency.
  `CREATE INDEX IF NOT EXISTS idx_books_last_opened
    ON books (last_opened_at DESC)`,

  // "Jump back" list (keep last 20 per book).
  `CREATE INDEX IF NOT EXISTS idx_position_history_book_at
    ON position_history (book_id, at DESC)`,

  // Bookmarks / sessions / stats queries per book.
  `CREATE INDEX IF NOT EXISTS idx_bookmarks_book
    ON bookmarks (book_id, page)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_book_started
    ON sessions (book_id, started_at DESC)`,
];

/** Convenience: CREATE statements only (no indexes). */
export const SCHEMA_TABLES_V1: readonly string[] = SCHEMA_STATEMENTS_V1.filter((s) =>
  /^\s*CREATE\s+(TABLE|VIRTUAL TABLE)/i.test(s),
);

/** Convenience: index statements only. */
export const SCHEMA_INDEXES_V1: readonly string[] = SCHEMA_STATEMENTS_V1.filter((s) =>
  /^\s*CREATE\s+INDEX/i.test(s),
);
