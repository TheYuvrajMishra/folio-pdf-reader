/**
 * base64.test.ts — round-trip and error cases for the pure-TS codec
 * (Hermes has no Buffer/atob for binary).
 */
import { base64Decode, base64Encode } from '../base64';

describe('base64 round-trip', () => {
  it('encodes and decodes empty input', () => {
    expect(base64Encode(new Uint8Array(0))).toBe('');
    expect(base64Decode('')).toEqual(new Uint8Array(0));
  });

  it('round-trips lengths 1..64 (padding coverage)', () => {
    for (let len = 1; len <= 64; len += 1) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + len) & 0xff;
      expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
    }
  });

  it('round-trips a 1 MiB buffer', () => {
    const bytes = new Uint8Array(1024 * 1024);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i & 0xff;
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes);
  });

  it('matches known vectors', () => {
    expect(base64Encode(new Uint8Array([102, 111, 111]))).toBe('Zm9v');
    expect(base64Decode('Zm9v')).toEqual(new Uint8Array([102, 111, 111]));
    expect(base64Decode('Zm8=')).toEqual(new Uint8Array([102, 111]));
    expect(base64Decode('Zg==')).toEqual(new Uint8Array([102]));
  });

  it('ignores whitespace', () => {
    expect(base64Decode('Zm9v\n')).toEqual(new Uint8Array([102, 111, 111]));
    expect(base64Decode(' Zm 9v ')).toEqual(new Uint8Array([102, 111, 111]));
  });
});

describe('base64Decode errors', () => {
  it('throws on invalid length', () => {
    expect(() => base64Decode('abc')).toThrow();
    expect(() => base64Decode('abcde')).toThrow();
  });

  it('throws on invalid characters', () => {
    expect(() => base64Decode('!!!!')).toThrow();
    expect(() => base64Decode('Zm$v')).toThrow();
  });
});
