/**
 * base64.ts — tiny base64 decoder (encode already lives in src/engine/base64.ts).
 *
 * Kept separate from the engine module so the library layer doesn't depend on
 * engine internals; the reader agent owns src/engine/. Platform-free.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  table['='.charCodeAt(0)] = 0;
  return table;
})();

/** Decode a base64 string to bytes. Throws on invalid input. */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, '');
  if (clean.length % 4 !== 0) {
    throw new Error('[folio] base64ToBytes: invalid length');
  }
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((clean.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);
    if (c0 > 127 || c1 > 127 || c2 > 127 || c3 > 127) {
      throw new Error('[folio] base64ToBytes: non-ASCII character');
    }
    const v0 = REVERSE[c0];
    const v1 = REVERSE[c1];
    const v2 = REVERSE[c2];
    const v3 = REVERSE[c3];
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) {
      throw new Error('[folio] base64ToBytes: invalid character');
    }
    const n = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;
    if (o < out.length) out[o++] = (n >>> 16) & 0xff;
    if (o < out.length) out[o++] = (n >>> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
