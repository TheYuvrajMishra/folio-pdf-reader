/**
 * export.test.ts — markdown/JSON export shape + excerpt derivation (M5).
 *
 * The builders are pure: annotations, page lines, title and clock are all
 * injected, so no DB or expo modules are touched.
 */

import {
  buildJson,
  buildMarkdown,
  deriveExcerpt,
  exportJson,
  exportMarkdown,
  type ExportAnnotation,
  type ExportSourceAnnotation,
} from '../export';

const FIXED_NOW = 1_790_000_000_000; // 2026-10-18

const src = (over: Partial<ExportSourceAnnotation> = {}): ExportSourceAnnotation => ({
  id: 'a1',
  book_id: 'b1',
  page: 124,
  type: 'highlight',
  color: 'yellow',
  opacity: 0.35,
  dataJson: {},
  note: null,
  ...over,
});

const line = (text: string, y0: number, y1: number) => ({ text, x0: 0.1, y0, x1: 0.9, y1 });

describe('deriveExcerpt', () => {
  test('prefers the store-provided excerpt', () => {
    const a = src({ dataJson: { excerpt: 'stored excerpt' } });
    expect(deriveExcerpt(a, [line('other text', 0, 0.1)])).toBe('stored excerpt');
  });

  test('derives text from lines intersecting the rects', () => {
    const a = src({
      dataJson: { rects: [{ x0: 0, y0: 0.2, x1: 1, y1: 0.3 }] },
    });
    const lines = [line('first line', 0.0, 0.1), line('target sentence here', 0.2, 0.28)];
    expect(deriveExcerpt(a, lines)).toBe('target sentence here');
  });

  test('joins multiple hit lines and truncates long text', () => {
    const a = src({
      dataJson: { rects: [{ x0: 0, y0: 0.0, x1: 1, y1: 0.5 }] },
    });
    const lines = [line('alpha', 0.0, 0.1), line('beta', 0.2, 0.3), line('gamma', 0.4, 0.49)];
    expect(deriveExcerpt(a, lines)).toBe('alpha beta gamma');
    const long = src({ dataJson: { rects: [{ x0: 0, y0: 0, x1: 1, y1: 1 }] } });
    const excerpt = deriveExcerpt(long, [line('x'.repeat(500), 0.1, 0.2)]);
    expect(excerpt.length).toBeLessThanOrEqual(160);
    expect(excerpt).toMatch(/…$/);
  });

  test('falls back to note, then type label', () => {
    expect(deriveExcerpt(src({ note: 'my thought' }), [])).toBe('my thought');
    expect(deriveExcerpt(src({ type: 'pen' }), [])).toBe('(pen)');
  });
});

const ann = (over: Partial<ExportAnnotation> = {}): ExportAnnotation => ({
  id: 'a1',
  page: 124,
  type: 'highlight',
  color: 'yellow',
  excerpt: 'the quick brown fox',
  note: 'remember this',
  rects: [],
  ...over,
});

describe('buildMarkdown', () => {
  test('groups by page with ## p.N, bullet per annotation + note', () => {
    const md = buildMarkdown('My Book', [
      ann(),
      ann({ id: 'a2', page: 124, color: 'blue', excerpt: 'second one', note: null }),
      ann({ id: 'a3', page: 130, color: 'pink', excerpt: 'later page', note: 'note here' }),
    ], FIXED_NOW);

    const lines = md.split('\n');
    expect(lines[0]).toBe('# My Book');
    // Page groups in order, one header per page.
    expect(md.match(/^## p\.124$/gm)?.length).toBe(1);
    expect(md.match(/^## p\.130$/gm)?.length).toBe(1);
    expect(md.indexOf('## p.124')).toBeLessThan(md.indexOf('## p.130'));
    // Bullets with color tags.
    expect(md).toContain('- [yellow] the quick brown fox');
    expect(md).toContain('  > remember this');
    expect(md).toContain('- [blue] second one');
    expect(md).toContain('- [pink] later page');
    expect(md).toContain('  > note here');
  });

  test('empty export stays valid', () => {
    const md = buildMarkdown('Empty', [], FIXED_NOW);
    expect(md).toContain('# Empty');
    expect(md).toContain('No highlights or notes yet.');
    expect(md).not.toContain('## p.');
  });

  test('note-less annotation emits no blockquote line', () => {
    const md = buildMarkdown('T', [ann({ note: null })], FIXED_NOW);
    expect(md).not.toContain('>');
  });
});

describe('buildJson', () => {
  test('mirrors the markdown data as JSON', () => {
    const json = buildJson('b1', 'My Book', [ann(), ann({ id: 'a2', page: 130 })], FIXED_NOW);
    const parsed = JSON.parse(json);
    expect(parsed.book_id).toBe('b1');
    expect(parsed.title).toBe('My Book');
    expect(parsed.exported_at).toBe(FIXED_NOW);
    expect(parsed.annotations).toHaveLength(2);
    expect(parsed.annotations[0]).toMatchObject({
      id: 'a1',
      page: 124,
      type: 'highlight',
      color: 'yellow',
      excerpt: 'the quick brown fox',
      note: 'remember this',
    });
  });
});

describe('exportMarkdown / exportJson (pipeline)', () => {
  const deps = {
    title: 'Pipeline Book',
    now: () => FIXED_NOW,
    listAnnotations: async () => [
      src({ id: 'a1', page: 5, dataJson: { rects: [{ x0: 0, y0: 0.1, x1: 1, y1: 0.2 }] }, note: 'n1' }),
      src({ id: 'a2', page: 2, dataJson: { excerpt: 'early excerpt' } }),
    ],
    getPageLines: async (_bookId: string, page: number) =>
      page === 5 ? [line('derived text wins', 0.1, 0.18)] : [],
  };

  test('sorts by page, derives excerpts, keeps notes', async () => {
    const md = await exportMarkdown('b1', deps);
    expect(md).toContain('# Pipeline Book');
    const i2 = md.indexOf('## p.2');
    const i5 = md.indexOf('## p.5');
    expect(i2).toBeGreaterThan(-1);
    expect(i5).toBeGreaterThan(i2); // sorted ascending
    expect(md).toContain('- [yellow] early excerpt');
    expect(md).toContain('- [yellow] derived text wins');
    expect(md).toContain('  > n1');
  });

  test('json pipeline carries book id', async () => {
    const parsed = JSON.parse(await exportJson('b1', deps));
    expect(parsed.book_id).toBe('b1');
    expect(parsed.annotations.map((a: { page: number }) => a.page)).toEqual([2, 5]);
  });
});
