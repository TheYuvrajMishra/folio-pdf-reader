/**
 * chunkWindow.ts — byte-window math for streamed chunked transfers (M6).
 *
 * Pure helper shared by the reader (bookSession open) and the background
 * indexer: chunk `index` of a `total`-byte file with `chunkBytes` per chunk.
 * Kept in its own module so it stays unit-testable without the Expo native
 * import chain.
 */

/** Byte window of chunk `index` for a streamed transfer. */
export function chunkWindow(
  index: number,
  total: number,
  chunkBytes: number,
): { position: number; length: number } {
  const position = index * chunkBytes;
  return { position, length: Math.min(chunkBytes, Math.max(0, total - position)) };
}
