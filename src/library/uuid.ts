/**
 * uuid.ts — tiny UUID v4 generator (no dependency; PRD §7.1 dependency budget).
 *
 * Uses crypto.getRandomValues when available, Math.random otherwise.
 * Platform-free.
 */

interface CryptoLike {
  getRandomValues?: (array: Uint8Array) => void;
}

function getCrypto(): CryptoLike | undefined {
  const g = globalThis as { crypto?: CryptoLike };
  return g.crypto;
}

/** Random UUID v4 string, e.g. '3f6a9c2e-1b4d-4f8a-9c1d-2e3f4a5b6c7d'. */
export function uuidv4(): string {
  const bytes = new Uint8Array(16);
  const crypto = getCrypto();
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx

  let hex = '';
  for (let i = 0; i < 16; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}
