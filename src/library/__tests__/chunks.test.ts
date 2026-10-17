import { chunkRanges, nextResumePage } from '../chunks';

describe('chunkRanges', () => {
  test('splits 25 pages into 10-page chunks', () => {
    expect(chunkRanges(25, 1, 10)).toEqual([
      { from: 1, to: 10 },
      { from: 11, to: 20 },
      { from: 21, to: 25 },
    ]);
  });

  test('resumes mid-book: indexed_pages=10 → start at 11', () => {
    const start = nextResumePage(10);
    expect(start).toBe(11);
    expect(chunkRanges(25, start, 10)).toEqual([
      { from: 11, to: 20 },
      { from: 21, to: 25 },
    ]);
  });

  test('fresh book: indexed_pages=0 → start at 1', () => {
    expect(nextResumePage(0)).toBe(1);
    expect(chunkRanges(5, nextResumePage(0), 10)).toEqual([{ from: 1, to: 5 }]);
  });

  test('fully indexed book → no chunks', () => {
    expect(chunkRanges(25, nextResumePage(25), 10)).toEqual([]);
  });

  test('start past the end → no chunks', () => {
    expect(chunkRanges(25, 30, 10)).toEqual([]);
  });

  test('single page book', () => {
    expect(chunkRanges(1, 1, 10)).toEqual([{ from: 1, to: 1 }]);
  });

  test('empty book → no chunks', () => {
    expect(chunkRanges(0, 1, 10)).toEqual([]);
  });

  test('clamps start below 1', () => {
    expect(chunkRanges(5, -3, 10)).toEqual([{ from: 1, to: 5 }]);
  });

  test('rejects invalid chunk size', () => {
    expect(() => chunkRanges(10, 1, 0)).toThrow();
  });
});
