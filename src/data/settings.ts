/**
 * settings.ts — typed key/value settings over the `settings` table.
 *
 * Values are stored as JSON (`value_json`); reads fall back to the caller's
 * default when the key is missing, the JSON is corrupt, or the DB is
 * unreachable — settings must never crash the reader.
 *
 * Keys owned by M2 (page animations, PRD §6.3):
 * - `page_animation`: 'curl' | 'slide' | 'fade' | 'none' (default 'curl')
 * - `animation_downgraded`: boolean latch set by the auto-downgrade
 *   (curl → slide when frame-time p95 > 24 ms for 3 consecutive turns)
 */

import { getDb } from './db';

/** Storage keys. */
export const SETTINGS_KEYS = {
  PAGE_ANIMATION: 'page_animation',
  ANIMATION_DOWNGRADED: 'animation_downgraded',
} as const;

/** Selectable page-turn animation styles (PRD §6.3). */
export type PageAnimationStyle = 'curl' | 'slide' | 'fade' | 'none';

export const DEFAULT_PAGE_ANIMATION: PageAnimationStyle = 'curl';
export const DEFAULT_ANIMATION_DOWNGRADED = false;

/** SELECT one setting by key. Row shape: { valueJson: string }. */
export const SQL_GET_SETTING = `
  SELECT value_json AS valueJson
  FROM settings
  WHERE key = ?
`;

/** UPSERT one setting (key is the PRIMARY KEY). */
export const SQL_SET_SETTING = `
  INSERT INTO settings (key, value_json)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
`;

/**
 * Read a setting, returning `fallback` when the key is missing, the stored
 * JSON fails to parse, or the database cannot be reached.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const db = await getDb();
    const row = await db.getFirstAsync<{ valueJson: string }>(SQL_GET_SETTING, [key]);
    if (!row) {
      return fallback;
    }
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

/** Write a setting (JSON-encoded). Overwrites any existing value. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(SQL_SET_SETTING, [key, JSON.stringify(value)]);
}
