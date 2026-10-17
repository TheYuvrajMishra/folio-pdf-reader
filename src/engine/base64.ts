/** Pure-TS base64 encoder (Hermes has no Buffer). Used to chunk PDF bytes. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  const len = bytes.length;
  let out = '';
  let i = 0;
  // Process 3 bytes -> 4 chars. Chunk the loop so very large inputs don't
  // blow the call stack or create pathological intermediate strings.
  for (; i + 3 <= len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + '=';
  }
  return out;
}

// Reverse lookup table for base64Decode: charCode -> 6-bit value (-1 invalid).
const B64_REV: Int8Array = (() => {
  const rev = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64.length; i += 1) rev[B64.charCodeAt(i)] = i;
  rev['='.charCodeAt(0)] = 0;
  return rev;
})();

/**
 * Pure-TS base64 decoder (Hermes has no Buffer/atob for binary).
 * Accepts whitespace (stripped); throws on malformed input.
 */
export function base64Decode(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const len = clean.length;
  if (len === 0) return new Uint8Array(0);
  if (len % 4 !== 0) throw new Error('base64Decode: invalid length');
  const pad = clean.charCodeAt(len - 1) === 61 ? (clean.charCodeAt(len - 2) === 61 ? 2 : 1) : 0;
  const out = new Uint8Array((len / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const c0 = clean.charCodeAt(i);
    const c1 = clean.charCodeAt(i + 1);
    const c2 = clean.charCodeAt(i + 2);
    const c3 = clean.charCodeAt(i + 3);
    const a = c0 < 128 ? B64_REV[c0] : -1;
    const b = c1 < 128 ? B64_REV[c1] : -1;
    const c = c2 < 128 ? B64_REV[c2] : -1;
    const d = c3 < 128 ? B64_REV[c3] : -1;
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('base64Decode: invalid character');
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >>> 16) & 0xff;
    if (o < out.length) out[o++] = (n >>> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
