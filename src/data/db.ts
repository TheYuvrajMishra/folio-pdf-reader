/**
 * SQLite database singleton for Folio.
 *
 * - Opens `folio.db` via expo-sqlite (`openDatabaseSync`, SDK 58 API).
 * - Enables WAL (`PRAGMA journal_mode=WAL`) for concurrent read/write
 *   (reader + background indexer) without blocking.
 * - Runs pending migrations on first open.
 *
 * Node/web guard: expo-sqlite has no Node runtime (it requires the native
 * module). It is loaded via dynamic `import()` only when `getDb()` is first
 * called, so importing this module in a Node test/benchmark does NOT crash —
 * only calling `getDb()` on an unsupported runtime throws.
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { runMigrations } from './migrations';

const DB_NAME = 'folio.db';

let dbInstance: SQLiteDatabase | null = null;

function isSupportedRuntime(): boolean {
  // React Native (Hermes/JSC). Node has `process.versions.node`, web has
  // neither navigator.product === 'ReactNative' nor native modules.
  return (
    typeof navigator !== 'undefined' && (navigator as { product?: string }).product === 'ReactNative'
  );
}

/** Open (or return) the shared SQLite database. */
export async function getDb(): Promise<SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  if (!isSupportedRuntime()) {
    throw new Error(
      'expo-sqlite is not available in this runtime (Node/web). ' +
        'getDb() can only be called on a React Native device/emulator.',
    );
  }
  // Dynamic import: static import would crash Node/web bundling at load time.
  const SQLite = await import('expo-sqlite');
  const db = SQLite.openDatabaseSync(DB_NAME);
  db.execSync('PRAGMA journal_mode=WAL;');
  runMigrations(db);
  dbInstance = db;
  return db;
}

/**
 * Run an async task inside a transaction, committing on success and rolling
 * back on throw. The db handle is provided to the task.
 */
export async function withTransaction<T>(task: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getDb();
  let result: T;
  await db.withTransactionAsync(async () => {
    result = await task(db);
  });
  // `result` is always assigned: withTransactionAsync rethrows on task error.
  return result!;
}

/** Close the database (mainly for tests / dev reload hygiene). */
export async function closeDb(): Promise<void> {
  if (dbInstance) {
    await dbInstance.closeAsync();
    dbInstance = null;
  }
}
