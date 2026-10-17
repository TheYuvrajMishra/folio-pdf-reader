/**
 * bookSession.ts — one open PDF document bound to the headless engine.
 *
 * Lifecycle: read the book file (base64 → Uint8Array, M1 cap 64 MB),
 * `engine.openBytes`, and keep the document open for the session lifetime.
 *
 * Rendering (PRD §7.3): renderPage → joined base64 → on-disk cache at
 * `documentDirectory/pages/<bookId>/<page>@<scale>.webp` (skipped when the
 * file already exists), plus an in-memory LRU of raster metadata (~50
 * entries). `prefetch()` renders ±2 pages fire-and-forget; a session epoch
 * drops results from stale epochs (fast scrubbing).
 *
 * M1 note: one session at a time — opening a new session closes the
 * previous one on the shared engine.
 */

import {
  documentDirectory,
  EncodingType,
  getInfoAsync,
  makeDirectoryAsync,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';

import { base64Decode } from '../engine/base64';
import { getEngine } from '../engine/engineHost';
import { PROTOCOL_CHUNK_BYTES } from '../engine/protocol';
import { extractLines, type Line } from '../engine/lines';
import type { PageGeom, Rotation } from '../util/geometry';
import { createLru, type LruMap } from './cache';
import { chunkWindow } from './chunkWindow';
import { prefetchWindow } from './readerMath';

/** M6: books up to 200 MB open via streamed chunked transfer (PRD §6.1). */
const MAX_OPEN_BYTES = 200 * 1024 * 1024;
/** In-memory raster metadata entries (PRD §7.3: LRU, ≈6 decoded bitmaps live in Skia). */
const RASTER_CACHE_ENTRIES = 50;
/** Prefetch radius around the current page (PRD §6.2: ±2). */
const PREFETCH_RADIUS = 2;

export interface PageRender {
  page: number;
  scale: number;
  /** Local file path (no file:// prefix) of the cached .webp. */
  path: string;
  widthPx: number;
  heightPx: number;
}

export interface BookSession {
  readonly bookId: string;
  readonly pageCount: number;
  readonly title: string | null;
  /** Rasterize (or fetch from cache) one page. */
  getPageImage(page: number, scale: number): Promise<PageRender>;
  /** Text lines for one page (normalized coords, scale-independent). */
  getPageLines(page: number): Promise<Line[]>;
  /** Page size in PDF points (for raster-scale selection). */
  getPageGeom(page: number): Promise<{ widthPt: number; heightPt: number }>;
  /** Fire-and-forget render of ±2 pages around `page`. */
  prefetch(page: number, scale: number): void;
  /** Close the document on the engine and invalidate pending work. */
  close(): Promise<void>;
}

interface RasterMeta {
  path: string;
  widthPx: number;
  heightPx: number;
}

function cacheKey(page: number, scale: number): string {
  return `${page}@${scale.toFixed(3)}`;
}

function toRotation(n: number): Rotation {
  return n === 90 || n === 180 || n === 270 ? n : 0;
}

function pagesDir(bookId: string): string {
  if (!documentDirectory) {
    throw new Error('Storage is unavailable on this device.');
  }
  return `${documentDirectory}pages/${bookId}/`;
}

async function ensureDir(dir: string): Promise<void> {
  const info = await getInfoAsync(dir);
  if (!info.exists) {
    await makeDirectoryAsync(dir, { intermediates: true });
  }
}

/** Marker error: a render finished after its session moved on. Never surfaced to UI. */
class StaleRenderError extends Error {
  constructor() {
    super('stale render dropped');
    this.name = 'StaleRenderError';
  }
}

class BookSessionImpl implements BookSession {
  readonly bookId: string;
  pageCount = 0;
  title: string | null = null;

  private readonly filePath: string;
  private epoch = 0;
  private closed = false;
  private opened = false;
  private readonly lru: LruMap<string, RasterMeta> = createLru<string, RasterMeta>(
    RASTER_CACHE_ENTRIES,
  );
  private readonly linesCache = new Map<number, Line[]>();
  private readonly geomCache = new Map<number, { widthPt: number; heightPt: number }>();
  private readonly inflight = new Map<string, Promise<PageRender>>();

  constructor(bookId: string, filePath: string) {
    this.bookId = bookId;
    this.filePath = filePath;
  }

  /** Read the file and open it on the engine (streamed — never whole in JS heap). */
  async open(): Promise<void> {
    const info = await getInfoAsync(this.filePath);
    if (!info.exists) {
      throw new Error("That file didn't open. It may have been moved or deleted.");
    }
    if (info.size > MAX_OPEN_BYTES) {
      throw new Error('This PDF is over 200 MB — too large for this build to open.');
    }
    const total = info.size;
    // Stream 512 KB base64 slices off disk; the engine reassembles them in
    // the WebView (PRD §7.3). Engine crash → retry the open (max 3, PRD §7.9).
    let attempt = 0;
    for (;;) {
      try {
        const result = await getEngine().openStreamed(total, async (index) => {
          // One disk read per engine chunk; the index math matches the
          // engine's chunking (default options).
          const { position, length } = chunkWindow(index, total, PROTOCOL_CHUNK_BYTES);
          const b64 = await readAsStringAsync(this.filePath, {
            encoding: EncodingType.Base64,
            position,
            length,
          });
          return base64Decode(b64);
        });
        this.pageCount = result.numPages;
        this.title = result.title;
        this.opened = true;
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 3) throw err;
        // Brief backoff, then re-open (the engine counts crashes internally).
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
    if (this.pageCount < 1) {
      throw new Error("That file didn't open. It may be damaged or protected.");
    }
  }

  private assertOpen(): void {
    if (this.closed || !this.opened) throw new Error('Book session is closed.');
  }

  private clampPage(page: number): number {
    if (!(page >= 1)) return 1;
    return Math.min(this.pageCount, Math.floor(page));
  }

  async getPageImage(page: number, scale: number): Promise<PageRender> {
    this.assertOpen();
    const p = this.clampPage(page);
    const s = scale > 0 ? scale : 1;
    const key = cacheKey(p, s);
    const hit = this.lru.get(key);
    if (hit) return { page: p, scale: s, ...hit };
    const running = this.inflight.get(key);
    if (running) return running;
    const epoch = this.epoch;
    const task = this.renderAndCache(p, s, key, epoch).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, task);
    return task;
  }

  private async renderAndCache(
    page: number,
    scale: number,
    key: string,
    epoch: number,
  ): Promise<PageRender> {
    const dir = pagesDir(this.bookId);
    await ensureDir(dir);
    const path = `${dir}${page}@${scale.toFixed(3)}.webp`;
    const metaPath = `${dir}${page}@${scale.toFixed(3)}.json`;

    // Disk cache hit: rehydrate from the sidecar, no re-render.
    const existing = await getInfoAsync(path);
    if (existing.exists) {
      try {
        const meta = JSON.parse(
          await readAsStringAsync(metaPath, { encoding: EncodingType.UTF8 }),
        ) as { widthPx: number; heightPx: number };
        if (typeof meta.widthPx === 'number' && typeof meta.heightPx === 'number') {
          const render: PageRender = { page, scale, path, widthPx: meta.widthPx, heightPx: meta.heightPx };
          if (epoch === this.epoch && !this.closed) {
            this.lru.set(key, { path, widthPx: meta.widthPx, heightPx: meta.heightPx });
          }
          return render;
        }
      } catch {
        // Corrupt sidecar — fall through and re-render.
      }
    }

    const result = await getEngine().renderPage(page, scale, 'webp', 0.85);
    if (epoch !== this.epoch || this.closed) throw new StaleRenderError();
    await writeAsStringAsync(path, result.chunks.join(''), { encoding: EncodingType.Base64 });
    await writeAsStringAsync(
      metaPath,
      JSON.stringify({ widthPx: result.widthPx, heightPx: result.heightPx }),
      { encoding: EncodingType.UTF8 },
    );
    const render: PageRender = {
      page,
      scale,
      path,
      widthPx: result.widthPx,
      heightPx: result.heightPx,
    };
    this.lru.set(key, { path, widthPx: result.widthPx, heightPx: result.heightPx });
    return render;
  }

  prefetch(page: number, scale: number): void {
    if (this.closed || !this.opened) return;
    const epoch = this.epoch;
    const s = scale > 0 ? scale : 1;
    for (const p of prefetchWindow(this.clampPage(page), this.pageCount, PREFETCH_RADIUS)) {
      const key = cacheKey(p, s);
      if (this.lru.has(key) || this.inflight.has(key)) continue;
      // Fire-and-forget: a stale epoch throws StaleRenderError, swallowed here.
      void this.renderAndCache(p, s, key, epoch).catch((err: unknown) => {
        if (!(err instanceof StaleRenderError)) {
          console.warn(`[folio] prefetch failed for p.${p}:`, err);
        }
      });
    }
  }

  async getPageLines(page: number): Promise<Line[]> {
    this.assertOpen();
    const p = this.clampPage(page);
    const cached = this.linesCache.get(p);
    if (cached) return cached;
    const res = await getEngine().getLines(p);
    const geom: PageGeom = {
      mediaW: res.widthPt,
      mediaH: res.heightPt,
      rotation: toRotation(res.rotation),
    };
    this.geomCache.set(p, { widthPt: res.widthPt, heightPt: res.heightPt });
    // EngineTextItem is structurally a superset of TextItem (str, transform,
    // width, height) — extractLines ignores the extra normalized fields.
    const lines = extractLines(res.items, geom);
    this.linesCache.set(p, lines);
    return lines;
  }

  async getPageGeom(page: number): Promise<{ widthPt: number; heightPt: number }> {
    this.assertOpen();
    const p = this.clampPage(page);
    const cached = this.geomCache.get(p);
    if (cached) return cached;
    await this.getPageLines(p);
    const geom = this.geomCache.get(p);
    if (!geom) throw new Error('Page geometry unavailable.');
    return geom;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Bump the epoch so any in-flight prefetch/render results are dropped.
    this.epoch += 1;
    this.lru.clear();
    this.linesCache.clear();
    this.geomCache.clear();
    this.inflight.clear();
    try {
      await getEngine().close();
    } catch {
      // The engine may already be down (crash path) — nothing to do.
    }
    if (currentSession === this) currentSession = null;
  }
}

let currentSession: BookSessionImpl | null = null;

/**
 * Open a book: read bytes, open on the engine, return the session.
 * Closes any previously open session first (M1: one session at a time).
 */
export async function openBookSession(book: {
  id: string;
  file_path: string;
}): Promise<BookSession> {
  if (currentSession) {
    await currentSession.close().catch(() => undefined);
    currentSession = null;
  }
  const session = new BookSessionImpl(book.id, book.file_path);
  await session.open();
  currentSession = session;
  return session;
}
