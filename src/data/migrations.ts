/**
 * Versioned SQLite migrations, tracked with `PRAGMA user_version`.
 *
 * - v0 -> v1: full initial schema from PRD §7.6 (see schema.ts).
 * - Each migration runs inside a single transaction and bumps
 *   `PRAGMA user_version` only on success, so a failed migration can be
 *   retried safely on next launch (CREATE ... IF NOT EXISTS is idempotent).
 */

import type { SQLiteDatabase } from 'expo-sqlite';
import { SCHEMA_STATEMENTS_V1 } from './schema';

export const LATEST_SCHEMA_VERSION = 1;

const MIGRATIONS: Readonly<Record<number, readonly string[]>> = {
  1: SCHEMA_STATEMENTS_V1,
};

/** Read the current schema version recorded on the database file. */
export function getSchemaVersion(db: SQLiteDatabase): number {
  const row = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Run all pending migrations, from `PRAGMA user_version` up to
 * `LATEST_SCHEMA_VERSION`. Safe to call on every app start.
 */
export function runMigrations(db: SQLiteDatabase): void {
  const current = getSchemaVersion(db);
  for (let version = current + 1; version <= LATEST_SCHEMA_VERSION; version += 1) {
    const statements = MIGRATIONS[version];
    if (!statements) {
      throw new Error(`Missing migration body for schema version ${version}`);
    }
    db.withTransactionSync(() => {
      for (const statement of statements) {
        db.execSync(statement);
      }
    });
    // Bump only after the transaction commits. A crash here re-runs the
    // (idempotent) statements next launch — no partial schema state.
    db.execSync(`PRAGMA user_version = ${version}`);
  }
}
