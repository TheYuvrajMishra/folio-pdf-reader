/** Tiny key/value settings over the `settings` table (PRD §7.6). */
import { getDb } from './db';

export async function getSetting<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value_json: string }>(
    'SELECT value_json FROM settings WHERE key=?;',
    [key],
  );
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings(key, value_json) VALUES(?,?);', [
    key,
    JSON.stringify(value),
  ]);
}
