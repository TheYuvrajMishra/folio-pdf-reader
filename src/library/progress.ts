/**
 * progress.ts — reading-progress math for the library UI (DESIGN §6.1).
 *
 * `page` is the 1-based current page from reading_position; `pageCount` the
 * book's total. Platform-free.
 */

/** Fraction 0..1 of the book read. 0 when page or pageCount is unknown. */
export function progressPercent(
  page: number | null | undefined,
  pageCount: number | null | undefined,
): number {
  if (!page || !pageCount || pageCount <= 0 || page <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, page / pageCount));
}

/**
 * DESIGN §6.1 hero meta, e.g. `p.124 / 612 · 20%`.
 * Falls back to `p.1` when the position is unknown, `p.N` when the total is.
 */
export function formatProgressMeta(
  page: number | null | undefined,
  pageCount: number | null | undefined,
): string {
  const p = page && page > 0 ? Math.floor(page) : 1;
  if (!pageCount || pageCount <= 0) {
    return `p.${p}`;
  }
  const pct = Math.round(progressPercent(p, pageCount) * 100);
  return `p.${p} / ${pageCount} · ${pct}%`;
}
