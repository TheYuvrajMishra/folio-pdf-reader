/**
 * sessions.ts — reading-session tracking + stats (M5, PRD §6.11).
 *
 * Table (see src/data/schema.ts):
 * - `sessions(id, book_id, started_at, ended_at, pages_read, active_seconds)`
 *
 * `SessionTracker` is platform-free and clock-injectable (unit-tested):
 * - `start(initialPage?)` begins a foreground segment.
 * - `recordPage(page)` adds the page to the distinct-pages set (and counts
 *   as interaction).
 * - `onBackground()` / `onForeground()` close/open segments so backgrounded
 *   gaps never count toward `activeSeconds`.
 * - `markInteraction()` resets the idle timer; any stretch of a segment
 *   beyond IDLE_MS (60 s, PRD §6.11: "pause when … no touch 60 s") after the
 *   last interaction is excluded.
 * - `finish()` closes the session → `{ pagesRead, activeSeconds }`.
 *
 * `startSession` / `endSession` persist rows; `getStreak` and
 * `getWeeklyPages` aggregate them. The daily goal lives in `settings` under
 * `stats.goal` as `{ kind: 'pages' | 'minutes', value: number }`.
 */

import type { SQLiteBindValue } from 'expo-sqlite';
import { getDb } from '../data/db';
import { getSetting, setSetting } from '../data/settings';

/** Idle cutoff: no touch for this long → the tail of the segment is inactive. */
export const IDLE_MS = 60_000;

/** A day counts toward the streak with at least this much active reading. */
export const STREAK_MIN_ACTIVE_SECONDS = 1;

export interface FinishedSession {
  pagesRead: number;
  /** Wall-clock seconds inside the app minus backgrounded gaps and idle tails. */
  activeSeconds: number;
}

interface Segment {
  start: number;
  end: number | null;
  lastTouch: number;
}

export class SessionTracker {
  private readonly now: () => number;
  private segments: Segment[] = [];
  private pages = new Set<number>();

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Begin tracking; the page the reader opened on counts as read. */
  start(initialPage?: number): void {
    const t = this.now();
    this.segments.push({ start: t, end: null, lastTouch: t });
    if (initialPage != null) this.recordPage(initialPage);
  }

  /** Record a page visit (also counts as interaction). */
  recordPage(page: number): void {
    this.pages.add(page);
    this.markInteraction();
  }

  /** Any touch / gesture — resets the 60 s idle timer. */
  markInteraction(): void {
    const seg = this.current();
    if (seg) seg.lastTouch = this.now();
  }

  /** App backgrounded (or reader unmounted): close the current segment. */
  onBackground(): void {
    const seg = this.current();
    if (seg && seg.end == null) seg.end = this.now();
  }

  /** App foregrounded: open a fresh segment (backgrounded gap excluded). */
  onForeground(): void {
    const cur = this.current();
    if (cur && cur.end == null) return; // already foreground
    const t = this.now();
    this.segments.push({ start: t, end: null, lastTouch: t });
  }

  /** Close the session and compute the totals. */
  finish(): FinishedSession {
    this.onBackground();
    let activeMs = 0;
    for (const seg of this.segments) {
      const end = seg.end ?? this.now();
      // Active until the earlier of: segment end, or 60 s after last touch.
      const activeEnd = Math.min(end, seg.lastTouch + IDLE_MS);
      activeMs += Math.max(0, activeEnd - seg.start);
    }
    return {
      pagesRead: this.pages.size,
      activeSeconds: Math.round(activeMs / 1000),
    };
  }

  private current(): Segment | null {
    const seg = this.segments[this.segments.length - 1];
    return seg && seg.end == null ? seg : null;
  }
}

/* ---------------- exported SQL (unit-tested as consts) ---------------- */

export const SQL_START_SESSION = `
  INSERT INTO sessions (book_id, started_at, pages_read, active_seconds)
  VALUES (?, ?, 0, 0)
`;

export const SQL_END_SESSION = `
  UPDATE sessions
  SET ended_at = ?, pages_read = ?, active_seconds = ?
  WHERE id = ?
`;

export const SQL_SESSION_DAYS = `
  SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day,
         SUM(active_seconds) AS active_seconds,
         SUM(pages_read) AS pages_read
  FROM sessions
  WHERE ended_at IS NOT NULL
    AND ({BOOK_FILTER})
  GROUP BY day
  ORDER BY day DESC
`;

function bookFilter(bookId?: string): { sql: string; params: SQLiteBindValue[] } {
  return bookId
    ? { sql: SQL_SESSION_DAYS.replace('{BOOK_FILTER}', 'book_id = ?'), params: [bookId] }
    : { sql: SQL_SESSION_DAYS.replace('{BOOK_FILTER}', '1 = 1'), params: [] };
}

/** Persist a session start; returns the row id. */
export async function startSession(bookId: string, startedAt?: number): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(SQL_START_SESSION, [bookId, startedAt ?? Date.now()]);
  return res.lastInsertRowId;
}

/** Persist a session end with its totals. */
export async function endSession(
  id: number,
  finished: FinishedSession,
  endedAt?: number,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(SQL_END_SESSION, [
    endedAt ?? Date.now(),
    finished.pagesRead,
    finished.activeSeconds,
    id,
  ]);
}

/* ---------------- date helpers (local time, testable) ---------------- */

export function dayString(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return dayString(dt.getTime());
}

interface DayRow {
  day: string;
  active_seconds: number;
  pages_read: number;
}

async function loadDayRows(bookId?: string): Promise<DayRow[]> {
  const { sql, params } = bookFilter(bookId);
  const db = await getDb();
  return db.getAllAsync<DayRow>(sql, params);
}

/**
 * Consecutive-day reading streak ending today (or yesterday when today has
 * no qualifying session yet — the streak is still alive). A day qualifies
 * with at least STREAK_MIN_ACTIVE_SECONDS of active reading.
 */
export async function getStreak(bookId?: string, now: number = Date.now()): Promise<number> {
  const rows = await loadDayRows(bookId);
  const active = new Set(
    rows.filter((r) => r.active_seconds >= STREAK_MIN_ACTIVE_SECONDS).map((r) => r.day),
  );
  let cursor = dayString(now);
  if (!active.has(cursor)) cursor = shiftDay(cursor, -1);
  let streak = 0;
  while (active.has(cursor)) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

export interface DayPages {
  /** Local `YYYY-MM-DD`. */
  day: string;
  pages: number;
}

/**
 * Pages read per day for the last 7 days (including today), oldest first.
 * Days without sessions report 0.
 */
export async function getWeeklyPages(
  bookId?: string,
  now: number = Date.now(),
): Promise<DayPages[]> {
  const rows = await loadDayRows(bookId);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.pages_read);

  const today = dayString(now);
  const out: DayPages[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = shiftDay(today, -i);
    out.push({ day, pages: byDay.get(day) ?? 0 });
  }
  return out;
}

/** Minutes read per day for the last 7 days (for minute-based goals). */
export async function getWeeklyMinutes(
  bookId?: string,
  now: number = Date.now(),
): Promise<DayPages[]> {
  const rows = await loadDayRows(bookId);
  const byDay = new Map<string, number>();
  for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.active_seconds);
  const today = dayString(now);
  const out: DayPages[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = shiftDay(today, -i);
    out.push({ day, pages: Math.round((byDay.get(day) ?? 0) / 60) });
  }
  return out;
}

/* ---------------- daily goal ---------------- */

export type GoalKind = 'pages' | 'minutes';

export interface DailyGoal {
  kind: GoalKind;
  value: number;
}

const GOAL_KEY = 'stats.goal';
export const DEFAULT_GOAL: DailyGoal = { kind: 'pages', value: 20 };

export async function getGoal(): Promise<DailyGoal> {
  // getSetting swallows missing keys / corrupt JSON / DB errors → default.
  const parsed = await getSetting<Partial<DailyGoal>>(GOAL_KEY, DEFAULT_GOAL);
  if (
    (parsed.kind === 'pages' || parsed.kind === 'minutes') &&
    typeof parsed.value === 'number' &&
    parsed.value > 0
  ) {
    return { kind: parsed.kind, value: Math.floor(parsed.value) };
  }
  return DEFAULT_GOAL;
}

export async function setGoal(goal: DailyGoal): Promise<void> {
  await setSetting(GOAL_KEY, goal);
}
