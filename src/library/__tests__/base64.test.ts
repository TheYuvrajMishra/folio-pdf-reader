import { base64ToBytes } from '../base64';

describe('base64ToBytes', () => {
  test('decodes a known vector', () => {
    expect(Array.from(base64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
  });

  test('round-trips random bytes against Node Buffer', () => {
    const bytes = new Uint8Array(1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
    const b64 = Buffer.from(bytes).toString('base64');
    expect(base64ToBytes(b64)).toEqual(bytes);
  });

  test('handles padding variants and whitespace', () => {
    expect(base64ToBytes('YWI=').length).toBe(2); // 1 pad char
    expect(base64ToBytes('YQ==').length).toBe(1); // 2 pad chars
    expect(base64ToBytes(' YWI=\n').length).toBe(2);
  });

  test('throws on invalid input', () => {
    expect(() => base64ToBytes('!!!')).toThrow();
    expect(() => base64ToBytes('abc')).toThrow(); // bad length
  });
});
