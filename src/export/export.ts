/**
 * export.ts — highlight/note export (M5, PRD §6.10).
 *
 * - `exportMarkdown(bookId)` / `exportJson(bookId)`: build the file contents.
 * - `shareExport(bookId, format)`: writes a temp .md/.json file and opens the
 *   system share sheet (expo-sharing). The share sheet is also the
 *   copy-to-clipboard path on Android (no expo-clipboard dependency;
 *   see the report).
 *
 * Annotation source: the annotations agent's `src/annotations/store.ts`
 * (`listAllAnnotations`). That file does not exist yet, so the import is
 * dynamic and defensive — export degrades to an empty (but valid) document
 * when the contract is absent. Excerpts come from `dataJson.excerpt` when the
 * store provides one, otherwise are derived from the page's text lines
 * (`page_lines`) intersecting the annotation rects.
 *
 * Pure builders (`buildMarkdown` / `buildJson`) take injected data so they
 * are unit-testable in Node; only `shareExport` touches expo modules, via
 * dynamic import like db.ts does.
 */

import { getDb } from '../data/db';
import { getBook } from '../data/books';

/** Annotation shape per the annotations agent's contract. */
export interface ExportSourceAnnotation {
  id: string;
  book_id: string;
  page: number;
  type: string;
  color: string;
  opacity: number;
  dataJson: {
    rects?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
    polyline?: unknown;
    noteAnchor?: unknown;
    excerpt?: string;
  };
  note: string | null;
}

export interface ExportAnnotation {
  id: string;
  page: number;
  type: string;
  color: string;
  excerpt: string;
  note: string | null;
  rects: Array<{ x0: number; y0: number; x1: number; y1: number }>;
}

interface PageLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Load all live annotations via the annotations agent's store (per-book class). */
async function loadAnnotations(bookId: string): Promise<ExportSourceAnnotation[]> {
  try {
    const { AnnotationStore } = await import('../annotations/store');
    const store = new AnnotationStore(bookId);
    const rows = await store.listAllAnnotations();
    return Array.isArray(rows) ? (rows as ExportSourceAnnotation[]) : [];
  } catch {
    return [];
  }
}

const SQL_PAGE_LINES = `
  SELECT text, x0, y0, x1, y1 FROM page_lines
  WHERE book_id = ? AND page = ?
  ORDER BY idx ASC
`;

async function getPageLines(bookId: string, page: number): Promise<PageLine[]> {
  const db = await getDb();
  return db.getAllAsync<PageLine>(SQL_PAGE_LINES, [bookId, page]);
}

/** Page text lines for excerpt derivation (also used by ContentsSheet). */
export async function fetchPageLines(bookId: string, page: number): Promise<PageLine[]> {
  try {
    return await getPageLines(bookId, page);
  } catch {
    return [];
  }
}

export type { PageLine };

function rectsOverlapVert(
  r: { y0: number; y1: number },
  l: { y0: number; y1: number },
): boolean {
  const top = Math.max(r.y0, l.y0);
  const bottom = Math.min(r.y1, l.y1);
  const overlap = bottom - top;
  if (overlap <= 0) return false;
  const smaller = Math.min(r.y1 - r.y0, l.y1 - l.y0);
  return smaller <= 0 || overlap / smaller > 0.3;
}

const EXCERPT_MAX = 160;

/**
 * Best-effort excerpt: store-provided excerpt, else the text lines
 * intersecting the annotation rects, else the note, else the type label.
 */
export function deriveExcerpt(
  a: ExportSourceAnnotation,
  lines: PageLine[],
): string {
  const provided = a.dataJson?.excerpt?.trim();
  if (provided) return truncate(provided, EXCERPT_MAX);

  const rects = a.dataJson?.rects;
  if (rects && rects.length > 0 && lines.length > 0) {
    const hit = lines
      .filter((l) => rects.some((r) => rectsOverlapVert(r, l)))
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (hit) return truncate(hit, EXCERPT_MAX);
  }

  if (a.note && a.note.trim()) return truncate(a.note.trim(), EXCERPT_MAX);
  return `(${a.type})`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export interface ExportDeps {
  title?: string;
  listAnnotations?: (bookId: string) => Promise<ExportSourceAnnotation[]>;
  getPageLines?: (bookId: string, page: number) => Promise<PageLine[]>;
  now?: () => number;
}

async function collect(bookId: string, deps: ExportDeps = {}): Promise<{
  title: string;
  annotations: ExportAnnotation[];
  exportedAt: number;
}> {
  const now = deps.now ?? Date.now;
  let title = deps.title;
  if (!title) {
    try {
      const book = await getBook(bookId);
      title = book?.title?.trim() ? book.title : 'Untitled';
    } catch {
      title = 'Untitled';
    }
  }
  const list = deps.listAnnotations ?? loadAnnotations;
  const linesFor = deps.getPageLines ?? getPageLines;
  const lineCache = new Map<number, PageLine[]>();

  const raw = await list(bookId);
  const live = raw.filter((a) => a && typeof a.page === 'number');
  live.sort((a, b) => a.page - b.page);

  const annotations: ExportAnnotation[] = [];
  for (const a of live) {
    let lines = lineCache.get(a.page);
    if (!lines) {
      try {
        lines = await linesFor(bookId, a.page);
      } catch {
        lines = [];
      }
      lineCache.set(a.page, lines);
    }
    annotations.push({
      id: a.id,
      page: a.page,
      type: a.type,
      color: a.color,
      excerpt: deriveExcerpt(a, lines),
      note: a.note?.trim() ? a.note.trim() : null,
      rects: Array.isArray(a.dataJson?.rects) ? a.dataJson.rects : [],
    });
  }
  return { title, annotations, exportedAt: now() };
}

/** Markdown export: grouped by page (`## p.124`), one `- [color] excerpt` per annotation + note. */
export function buildMarkdown(
  title: string,
  annotations: ExportAnnotation[],
  exportedAt: number,
): string {
  const out: string[] = [];
  out.push(`# ${title}`);
  out.push('');
  out.push(`Exported ${new Date(exportedAt).toISOString().slice(0, 10)} · ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}`);
  out.push('');

  let lastPage = -1;
  for (const a of annotations) {
    if (a.page !== lastPage) {
      out.push(`## p.${a.page}`);
      out.push('');
      lastPage = a.page;
    }
    out.push(`- [${a.color}] ${a.excerpt}`);
    if (a.note) out.push(`  > ${a.note}`);
  }
  if (annotations.length === 0) {
    out.push('No highlights or notes yet.');
  }
  out.push('');
  return out.join('\n');
}

/** JSON export: machine-readable mirror of the markdown. */
export function buildJson(
  bookId: string,
  title: string,
  annotations: ExportAnnotation[],
  exportedAt: number,
): string {
  return (
    JSON.stringify(
      {
        book_id: bookId,
        title,
        exported_at: exportedAt,
        annotations: annotations.map((a) => ({
          id: a.id,
          page: a.page,
          type: a.type,
          color: a.color,
          excerpt: a.excerpt,
          note: a.note,
          rects: a.rects,
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

/** Full pipeline → markdown string. */
export async function exportMarkdown(bookId: string, deps: ExportDeps = {}): Promise<string> {
  const { title, annotations, exportedAt } = await collect(bookId, deps);
  return buildMarkdown(title, annotations, exportedAt);
}

/** Full pipeline → JSON string. */
export async function exportJson(bookId: string, deps: ExportDeps = {}): Promise<string> {
  const { title, annotations, exportedAt } = await collect(bookId, deps);
  return buildJson(bookId, title, annotations, exportedAt);
}

export type ExportFormat = 'md' | 'json';

/**
 * Write the export to a temp file and open the system share sheet.
 * RN-only (dynamic expo imports); throws when storage is unavailable.
 */
export async function shareExport(bookId: string, format: ExportFormat): Promise<void> {
  const [{ cacheDirectory, writeAsStringAsync, EncodingType }, { shareAsync }] =
    await Promise.all([import('expo-file-system/legacy'), import('expo-sharing')]);
  if (!cacheDirectory) throw new Error('Storage is unavailable on this device.');
  const content = format === 'md' ? await exportMarkdown(bookId) : await exportJson(bookId);
  const ext = format === 'md' ? 'md' : 'json';
  const filename = `folio-highlights-${bookId.slice(0, 8)}.${ext}`;
  const uri = `${cacheDirectory}${filename}`;
  await writeAsStringAsync(uri, content, { encoding: EncodingType.UTF8 });
  await shareAsync(uri, { dialogTitle: 'Share highlights' });
}
