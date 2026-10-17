import { sha256Bytes, sha256Hex, sha256HexOfString } from '../sha256';

// NIST FIPS 180-4 test vectors.
describe('sha256', () => {
  test('empty string', () => {
    expect(sha256HexOfString('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  test('"abc" (single block)', () => {
    expect(sha256HexOfString('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  test('112-char message (two blocks)', () => {
    expect(sha256HexOfString('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  test('56-byte boundary (padding spans into second block)', () => {
    // Cross-checked against Node's crypto in this same test run.
    const input = new Uint8Array(56).fill(0x61);
    const expected = nodeSha256Hex(input);
    expect(sha256Hex(input)).toBe(expected);
  });

  test('1 MiB input (import hash head size)', () => {
    const input = new Uint8Array(1024 * 1024);
    for (let i = 0; i < input.length; i++) input[i] = i & 0xff;
    expect(sha256Hex(input)).toBe(nodeSha256Hex(input));
  });

  test('sha256Bytes returns 32 bytes and matches sha256Hex', () => {
    const digest = sha256Bytes(new TextEncoder().encode('folio'));
    expect(digest).toHaveLength(32);
    expect(sha256Hex(new TextEncoder().encode('folio'))).toBe(
      Buffer.from(digest).toString('hex'),
    );
  });
});

// Oracle: Node's built-in crypto (test-only, never shipped to the app).
function nodeSha256Hex(data: Uint8Array): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(data).digest('hex');
}
