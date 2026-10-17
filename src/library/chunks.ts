/**
 * chunks.ts — chunking / resume math for the background line indexer (PRD §6.1).
 *
 * The indexer walks pages 1..N in fixed-size chunks and records progress in
 * books.indexed_pages (count of contiguously indexed pages from page 1).
 * A crash or app kill resumes at indexed_pages + 1; per-page DELETE+INSERT
 * inside the chunk transaction makes re-runs idempotent.
 *
 * Platform-free: pure math, unit-tested.
 */

/** One 1-based inclusive page range. */
export interface PageChunk {
  from: number;
  to: number;
}

/**
 * Split pages [startPage..totalPages] (1-based, inclusive) into chunks of at
 * most `chunkSize` pages. Returns [] when there is nothing to do.
 */
export function chunkRanges(totalPages: number, startPage: number, chunkSize: number): PageChunk[] {
  if (chunkSize < 1) {
    throw new Error(`[folio] chunkRanges: invalid chunkSize ${chunkSize}`);
  }
  const total = Math.floor(totalPages);
  const start = Math.max(1, Math.floor(startPage));
  if (total < 1 || start > total) {
    return [];
  }
  const out: PageChunk[] = [];
  for (let from = start; from <= total; from += chunkSize) {
    out.push({ from, to: Math.min(total, from + chunkSize - 1) });
  }
  return out;
}

/**
 * 1-based page number where indexing should resume, given the persisted
 * `indexed_pages` count. indexed_pages = 0 (fresh book) → start at page 1.
 */
export function nextResumePage(indexedPages: number): number {
  return Math.max(1, Math.floor(indexedPages) + 1);
}
