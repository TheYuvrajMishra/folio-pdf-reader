import { compareBooks, type Book } from '../books';

const book = (over: Partial<Book> & { id: string; title: string }): Book => ({
  author: null,
  filePath: `/books/${over.id}.pdf`,
  sizeBytes: null,
  pageCount: null,
  coverPath: null,
  hash: null,
  addedAt: 1000,
  lastOpenedAt: null,
  indexedPages: 0,
  deletedAt: null,
  ...over,
});

describe('compareBooks', () => {
  test('recent: lastOpenedAt desc, never-opened falls back to addedAt', () => {
    const a = book({ id: 'a', title: 'A', lastOpenedAt: 3000 });
    const b = book({ id: 'b', title: 'B', lastOpenedAt: 1000 });
    const c = book({ id: 'c', title: 'C', addedAt: 5000 }); // never opened, added later
    const sorted = [b, c, a].sort((x, y) => compareBooks(x, y, 'recent'));
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'b']);
  });

  test('title: case-insensitive A→Z with recency tiebreak', () => {
    const a = book({ id: 'a', title: 'banana', lastOpenedAt: 1000 });
    const b = book({ id: 'b', title: 'Apple', lastOpenedAt: 2000 });
    const c = book({ id: 'c', title: 'cherry' });
    const sorted = [a, c, b].sort((x, y) => compareBooks(x, y, 'title'));
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  test('progress: lastOpenedAt desc, never-opened last', () => {
    const a = book({ id: 'a', title: 'A', lastOpenedAt: 1000 });
    const b = book({ id: 'b', title: 'B', lastOpenedAt: 4000 });
    const c = book({ id: 'c', title: 'C', addedAt: 9999 }); // never opened
    const sorted = [a, c, b].sort((x, y) => compareBooks(x, y, 'progress'));
    expect(sorted.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  test('equal keys are stable-ish (returns 0)', () => {
    const a = book({ id: 'a', title: 'Same', lastOpenedAt: 1000 });
    const b = book({ id: 'b', title: 'Same', lastOpenedAt: 1000 });
    expect(compareBooks(a, b, 'title')).toBe(0);
    expect(compareBooks(a, b, 'recent')).toBe(0);
  });
});
