/**
 * indexer.ts — background book indexing job (PRD §6.1).
 *
 * `startBackgroundIndex(bookId)` is fire-and-forget and never throws: it
 * opens the PDF in the headless engine (serialized via engineSerial), then
 *   1. writes pageCount + metadata title/author to the book row,
 *   2. renders page 1 at 400 px wide → `covers/<bookId>.webp`,
 *   3. extracts text lines page by page in 10-page chunks, persisting to
 *      `page_lines` + the `page_text` FTS table, recording progress in
 *      `books.indexed_pages`.
 *
 * Chunking yields to the event loop between pages (`setImmediate`) so the
 * reader never janks; the job is resumable (skips already-indexed pages)
 * and guarded so two indexers never run for the same book.
 *
 * Limits: files larger than the engine's chunked-transfer ceiling (64 MiB)
 * are skipped — opening them needs the file:// open-url path, which the
 * reader agent's EngineHost wires up (see engineSerial.ts header).
 */

import * as FS from 'expo-file-system/legacy';

import { withTransaction } from '../data/db';
import { getBook, updateBook } from '../data/books';
import { extractLines, type Line, type TextItem } from '../engine/lines';
import { PROTOCOL_CHUNK_BYTES } from '../engine/protocol';
import type { PdfEngine } from '../engine/PdfEngine';
import type { PageGeom } from '../util/geometry';
import { chunkRanges, nextResumePage } from './chunks';
import { withEngineDocumentStreamed } from './engineSerial';
import { base64ToBytes } from './base64';

/** Pages per persist chunk (PRD §6.1: chunked, resumable). */
export const INDEX_CHUNK_PAGES = 10;
/** Cover width target, px (PRD §6.1: page 1 @ 400 px). */
export const COVER_WIDTH_PX = 400;
/** Engine chunked-transfer ceiling — see PdfEngine.CHUNKED_TRANSFER_LIMIT_BYTES. */
const MAX_INDEX_BYTES = 200 * 1024 * 1024;

/** Books with a live indexer right now. Guard: never two for one book. */
const activeIndexers = new Set<string>();

/** True while a background index job is running for this book. */
export function isIndexing(bookId: string): boolean {
  return activeIndexers.has(bookId);
}

/**
 * Start the background index job for a book. Returns immediately; the job
 * never throws (failures are logged) and a second call for the same book
 * while one is running is a no-op.
 */
export function startBackgroundIndex(bookId: string): void {
  if (activeIndexers.has(bookId)) {
    return;
  }
  activeIndexers.add(bookId);
  void runIndex(bookId)
    .catch((err) => {
      console.warn(`[folio] background index failed for book ${bookId}`, err);
    })
    .finally(() => {
      activeIndexers.delete(bookId);
    });
}

function asRotation(rotation: number): PageGeom['rotation'] {
  return rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
}

function yieldToLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function runIndex(bookId: string): Promise<void> {
  const book = await getBook(bookId);
  if (!book) {
    return;
  }
  const size = book.sizeBytes ?? 0;
  if (size > MAX_INDEX_BYTES) {
    console.warn(
      `[folio] skipping index for book ${bookId}: ${size} bytes exceeds the ` +
        'engine chunked-transfer limit (200 MiB).',
    );
    return;
  }

  // Stream the file off disk in engine-sized chunks — never whole in memory.
  const readChunk = async (index: number): Promise<Uint8Array> => {
    const position = index * PROTOCOL_CHUNK_BYTES;
    const length = Math.min(PROTOCOL_CHUNK_BYTES, size - position);
    const b64 = await FS.readAsStringAsync(book.filePath, {
      encoding: FS.EncodingType.Base64,
      position,
      length,
    });
    return base64ToBytes(b64);
  };
  await withEngineDocumentStreamed(size, readChunk, async (engine, opened) => {
    const numPages = opened.numPages;
    await updateBook(bookId, {
      pageCount: numPages,
      title: opened.title?.trim() ? opened.title.trim() : book.title,
      author: opened.author?.trim() ? opened.author.trim() : book.author,
    });

    try {
      await renderCover(engine, bookId);
    } catch (err) {
      console.warn(`[folio] cover render failed for book ${bookId}`, err);
    }

    // Resumable: pick up after the last fully indexed chunk.
    const fresh = await getBook(bookId);
    const start = nextResumePage(fresh?.indexedPages ?? 0);
    for (const chunk of chunkRanges(numPages, start, INDEX_CHUNK_PAGES)) {
      for (let page = chunk.from; page <= chunk.to; page++) {
        const res = await engine.getLines(page);
        const items: TextItem[] = res.items.map((it) => ({
          str: it.str,
          transform: it.transform,
          width: it.width,
          height: it.height,
        }));
        const geom: PageGeom = {
          mediaW: res.widthPt,
          mediaH: res.heightPt,
          rotation: asRotation(res.rotation),
        };
        const lines = extractLines(items, geom);
        await persistPageLines(bookId, page, lines);
        await yieldToLoop();
      }
      await updateBook(bookId, { indexedPages: chunk.to });
    }
  });
}

/** Render page 1 at COVER_WIDTH_PX wide → covers/<bookId>.webp (base64 write). */
async function renderCover(engine: PdfEngine, bookId: string): Promise<void> {
  const first = await engine.getLines(1);
  if (!(first.widthPt > 0)) {
    return;
  }
  const scale = COVER_WIDTH_PX / first.widthPt;
  const rendered = await engine.renderPage(1, scale, 'webp', 0.85);
  const b64 = rendered.chunks.join('');
  if (!b64) {
    return;
  }
  const base = FS.documentDirectory;
  if (!base) {
    return;
  }
  const coversDir = `${base}covers/`;
  const info = await FS.getInfoAsync(coversDir);
  if (!info.exists) {
    await FS.makeDirectoryAsync(coversDir, { intermediates: true });
  }
  const coverUri = `${coversDir}${bookId}.webp`;
  await FS.writeAsStringAsync(coverUri, b64, { encoding: FS.EncodingType.Base64 });
  await updateBook(bookId, { coverPath: coverUri });
}

/**
 * Persist one page's lines + its FTS row. DELETE+INSERT per page makes
 * re-runs (resume after a crash) idempotent; the whole page lands in one
 * transaction.
 */
async function persistPageLines(bookId: string, page: number, lines: Line[]): Promise<void> {
  const text = lines.map((l) => l.text).join('\n');
  await withTransaction(async (db) => {
    db.runSync('DELETE FROM page_lines WHERE book_id = ? AND page = ?', [bookId, page]);
    for (const line of lines) {
      db.runSync(
        `INSERT INTO page_lines
           (book_id, page, idx, x0, y0, x1, y1, text, kind)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bookId,
          page,
          line.idx,
          line.box.x0,
          line.box.y0,
          line.box.x1,
          line.box.y1,
          line.text,
          line.kind,
        ],
      );
    }
    db.runSync('DELETE FROM page_text WHERE book_id = ? AND page = ?', [bookId, page]);
    db.runSync('INSERT INTO page_text (book_id, page, text) VALUES (?, ?, ?)', [
      bookId,
      page,
      text,
    ]);
  });
}
