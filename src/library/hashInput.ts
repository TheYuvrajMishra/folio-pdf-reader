/**
 * hashInput.ts — duplicate-detection hash for PDF import (PRD §6.1).
 *
 * Hash input = (first 1 MiB of the file) ++ (file size as 8-byte
 * little-endian). Hashing the head instead of the whole file keeps import
 * fast on ≥200 MB PDFs without ever loading the file into JS memory;
 * appending the size makes same-prefix/different-length files distinct.
 *
 * Platform-free: pure byte manipulation + ./sha256.
 */

import { sha256Hex } from './sha256';

/** How many leading bytes of the PDF feed the duplicate hash. */
export const HASH_HEAD_BYTES = 1024 * 1024;

/**
 * Build the exact byte string that gets hashed: head bytes followed by the
 * file size encoded as 8-byte little-endian (full 64-bit range).
 */
export function buildHashInput(firstBytes: Uint8Array, sizeBytes: number): Uint8Array {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error(`[folio] buildHashInput: invalid size ${sizeBytes}`);
  }
  const out = new Uint8Array(firstBytes.length + 8);
  out.set(firstBytes, 0);
  const view = new DataView(out.buffer, out.byteOffset + firstBytes.length, 8);
  // 64-bit little-endian: low word at offset 0, high word at offset 4.
  // (DataView is big-endian by default — pass littleEndian=true.)
  view.setUint32(0, sizeBytes >>> 0, true); // low word (ToUint32 = mod 2^32)
  view.setUint32(4, Math.floor(sizeBytes / 0x100000000), true); // high word
  return out;
}

/** SHA-256 hex of the duplicate-detection input for one PDF. */
export function hashPdfHead(firstBytes: Uint8Array, sizeBytes: number): string {
  return sha256Hex(buildHashInput(firstBytes, sizeBytes));
}
