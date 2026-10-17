/**
 * chunkWindow.test.ts — M6 streamed-transfer chunk math.
 */
import { chunkWindow } from '../chunkWindow';

describe('chunkWindow', () => {
  const MB = 1024 * 1024;

  test('first chunk starts at 0 with full length', () => {
    expect(chunkWindow(0, 10 * MB, MB)).toEqual({ position: 0, length: MB });
  });

  test('middle chunks tile exactly', () => {
    expect(chunkWindow(3, 10 * MB, MB)).toEqual({ position: 3 * MB, length: MB });
  });

  test('last chunk is truncated to the remainder', () => {
    const total = 10 * MB + 123;
    expect(chunkWindow(10, total, MB)).toEqual({ position: 10 * MB, length: 123 });
  });

  test('chunks tile the whole file without gaps or overlap', () => {
    const total = 80 * MB + 7;
    const chunk = 512 * 1024;
    const n = Math.ceil(total / chunk);
    let covered = 0;
    for (let i = 0; i < n; i++) {
      const w = chunkWindow(i, total, chunk);
      expect(w.position).toBe(covered);
      covered += w.length;
    }
    expect(covered).toBe(total);
  });

  test('chunk count matches the engine protocol', () => {
    const total = 80 * MB;
    const chunk = 512 * 1024;
    expect(Math.ceil(total / chunk)).toBe(160);
    const last = chunkWindow(159, total, chunk);
    expect(last).toEqual({ position: 159 * chunk, length: chunk });
  });
});
