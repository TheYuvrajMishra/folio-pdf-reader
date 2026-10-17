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
