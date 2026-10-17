/**
 * rulerSettings.ts — reading-ruler settings access (PRD §6.5, DESIGN §6.3).
 *
 * Settings live in the global `settings` table (schema v1) under a single
 * JSON row (`ruler.settings`). If src/data/settings.ts ever gains a generic
 * accessor, this module should be re-homed behind it — the shape below is
 * deliberately narrow so the reconciliation is mechanical.
 *
 * Platform note: this module imports getDb from ../data/db, which is
 * Node/web-safe at import time (the native module loads only inside getDb()).
 */

import { getDb } from '../data/db';

/** Band visual style. P0 = band; spotlight/underline are P1 (DESIGN §6.5). */
export type RulerBandStyle = 'band' | 'spotlight' | 'underline';

export interface RulerSettings {
  /** Band fill hex, #RRGGBB. */
  color: string;
  /** Band fill alpha 0..1 (DESIGN default 0.22). */
  opacity: number;
  /** Text lines covered by the band, 1..3. */
  lines: 1 | 2 | 3;
  /** Glide the band between lines with a spring. */
  glide: boolean;
  /** Light haptic tick on each step. */
  haptics: boolean;
  /** Skip kind:'margin' lines (headers/footers/page numbers) while stepping. */
  skipHeaders: boolean;
  /** Band visual style. */
  style: RulerBandStyle;
  /** Extra band padding in normalized page units (0..0.02). */
  padding: number;
  /** Pill edge; the pill remembers its side (PRD §6.5). */
  side: 'left' | 'right';
}

export const DEFAULT_RULER_SETTINGS: RulerSettings = {
  color: '#FFB020',
  opacity: 0.22,
  lines: 1,
  glide: true,
  haptics: true,
  skipHeaders: true,
  style: 'band',
  padding: 0.003,
  side: 'right',
};

const SETTINGS_KEY = 'ruler.settings';

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/** Numeric field: missing/NaN → default, otherwise clamped. */
function numOr(v: unknown, dflt: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Merge a raw (possibly partial/corrupt) row over the defaults, clamping
 * every field into its valid range. Never throws.
 */
export function sanitizeRulerSettings(raw: unknown): RulerSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof RulerSettings, unknown>
  >;
  const linesRaw = Number(r.lines);
  const lines = Number.isFinite(linesRaw) ? Math.round(linesRaw) : 1;
  return {
    color: isHexColor(r.color) ? r.color : DEFAULT_RULER_SETTINGS.color,
    opacity: numOr(r.opacity, DEFAULT_RULER_SETTINGS.opacity, 0.05, 1),
    lines: lines === 2 || lines === 3 ? (lines as 2 | 3) : 1,
    glide: r.glide === undefined ? true : r.glide === true,
    haptics: r.haptics === undefined ? true : r.haptics === true,
    skipHeaders: r.skipHeaders === undefined ? true : r.skipHeaders === true,
    style:
      r.style === 'spotlight' || r.style === 'underline' ? r.style : 'band',
    padding: numOr(r.padding, DEFAULT_RULER_SETTINGS.padding, 0, 0.02),
    side: r.side === 'left' ? 'left' : 'right',
  };
}

/** Read the current ruler settings (defaults when no row exists yet). */
export async function getRulerSettings(): Promise<RulerSettings> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value_json: string }>(
    'SELECT value_json FROM settings WHERE key = ?',
    [SETTINGS_KEY],
  );
  if (!row) return { ...DEFAULT_RULER_SETTINGS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value_json);
  } catch {
    return { ...DEFAULT_RULER_SETTINGS };
  }
  return sanitizeRulerSettings(parsed);
}

/**
 * Persist a partial update; returns the full sanitized settings.
 * Unknown/out-of-range values are clamped, never stored raw.
 */
export async function setRulerSettings(
  patch: Partial<RulerSettings>,
): Promise<RulerSettings> {
  const merged = sanitizeRulerSettings({ ...(await getRulerSettings()), ...patch });
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)', [
    SETTINGS_KEY,
    JSON.stringify(merged),
  ]);
  return merged;
}
