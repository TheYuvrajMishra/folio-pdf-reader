import { buildHashInput, HASH_HEAD_BYTES, hashPdfHead } from '../hashInput';
import { sha256Hex } from '../sha256';

describe('buildHashInput', () => {
  test('is head bytes ++ 8-byte little-endian size', () => {
    const head = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const input = buildHashInput(head, 0x0102030405);
    expect(input.length).toBe(head.length + 8);
    expect(Array.from(input.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    // Little-endian 0x0102030405 → 05 04 03 02 01 00 00 00
    expect(Array.from(input.slice(4))).toEqual([0x05, 0x04, 0x03, 0x02, 0x01, 0x00, 0x00, 0x00]);
  });

  test('size 0 encodes as eight zero bytes', () => {
    const input = buildHashInput(new Uint8Array(0), 0);
    expect(input.length).toBe(8);
    expect(Array.from(input)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test('same head, different sizes → different hashes', () => {
    const head = new Uint8Array(16).fill(7);
    expect(hashPdfHead(head, 100)).not.toBe(hashPdfHead(head, 101));
  });

  test('hashPdfHead = sha256Hex(buildHashInput(...))', () => {
    const head = new Uint8Array([1, 2, 3]);
    expect(hashPdfHead(head, 999)).toBe(sha256Hex(buildHashInput(head, 999)));
  });

  test('HASH_HEAD_BYTES is 1 MiB', () => {
    expect(HASH_HEAD_BYTES).toBe(1024 * 1024);
  });

  test('rejects invalid sizes', () => {
    expect(() => buildHashInput(new Uint8Array(1), -1)).toThrow();
    expect(() => buildHashInput(new Uint8Array(1), 1.5)).toThrow();
  });
});
