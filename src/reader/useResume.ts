/**
 * useResume.ts — resume controller for the reader screen (PRD §6.4).
 *
 * The reader agent instantiates `ResumeController` (or uses the `useResume`
 * hook) with a book id and callbacks:
 *   - `getLines(page)` — fetch the page's text lines (from the line index).
 *   - `onRestore({page, yNorm, lineIndex})` — the READER consumes this:
 *     it scrolls/zooms to yNorm, places the ruler on lineIndex, and shows
 *     the "Resumed · p.X, line Y" chip (DESIGN §11). This module only
 *     exposes the data; rendering stays in the reader.
 *
 * Save policy (PRD §6.4):
 *   - `reportPage` — called on page change; debounced 400 ms; pushes to
 *     the jump-back history only when the page actually changed.
 *   - `reportRuler` — called on ruler steps; debounced 400 ms; never
 *     touches history (history is page-granular).
 *   - Both channels debounce independently: at most one save per 400 ms
 *     per trigger type; rapid calls coalesce into a single save with the
 *     latest values.
 *   - `flush()` force-writes any pending debounced save immediately —
 *     call it on AppState background/inactive (done automatically) and on
 *     reader unmount, then `dispose()`.
 *   - `setRulerEnabled(on)` flips the persisted ruler flag and schedules
 *     a debounced save of the last known position so a lone toggle is not
 *     lost.
 *
 * Lifecycle: the controller subscribes to AppState itself in the
 * constructor and flushes on 'background'/'inactive'. Call `dispose()` to
 * unsubscribe (typically after flush() on unmount).
 */

import { useEffect, useRef, useState } from 'react';
import { getPosition, pushHistory, savePosition, type SavedPosition } from '../data/positions';
import { resolvePosition } from './resume';
import type { Line } from '../engine/lines';
import { addAppStateListener, type AppStateSubscription } from './appState';

export interface ResumeCallbacks {
  getLines(page: number): Promise<Line[]>;
  onRestore(r: { page: number; yNorm: number; lineIndex: number | null; rulerEnabled: boolean }): void;
}

/** Debounce window for saves (PRD §6.4). */
export const RESUME_SAVE_DEBOUNCE_MS = 400;

type SaveChannel = 'page' | 'ruler';

interface PendingReport {
  page: number;
  lineIndex: number;
  yNorm: number;
  snippet: string;
  /** True for reportPage: may push to history when the page changed. */
  fromPage: boolean;
}

export class ResumeController {
  private readonly bookId: string;
  private readonly cb: ResumeCallbacks;

  private rulerEnabled = false;
  /** Last known position (seeded by restore(), updated on every save). */
  private lastKnown: SavedPosition | null = null;
  /** Page of the most recent history entry; null until restore/first push. */
  private lastHistoryPage: number | null = null;

  private readonly pending: Record<SaveChannel, PendingReport | null> = {
    page: null,
    ruler: null,
  };
  private readonly timers: Record<SaveChannel, ReturnType<typeof setTimeout> | null> = {
    page: null,
    ruler: null,
  };
  private appStateSub: AppStateSubscription | null;

  constructor(bookId: string, cb: ResumeCallbacks) {
    this.bookId = bookId;
    this.cb = cb;
    this.appStateSub = addAppStateListener((status) => {
      if (status === 'background' || status === 'inactive') {
        // Fire-and-forget: never block the app-state transition.
        void this.flush();
      }
    });
  }

  /**
   * Restore the saved position. No saved row → page 1, top of page.
   * Loads the page's lines (tolerates failure → y_norm-only resume),
   * re-resolves the line via resolvePosition (snippet re-find, then
   * y_norm fallback), and reports it through onRestore.
   */
  async restore(): Promise<void> {
    const saved = await getPosition(this.bookId);
    if (!saved) {
      this.cb.onRestore({ page: 1, yNorm: 0, lineIndex: null, rulerEnabled: false });
      return;
    }
    this.rulerEnabled = saved.ruler_enabled === 1;
    this.lastKnown = saved;
    // Seed so the restored page is not re-pushed as a "change".
    this.lastHistoryPage = saved.page;

    let lines: Line[] = [];
    try {
      lines = (await this.cb.getLines(saved.page)) ?? [];
    } catch {
      lines = []; // engine/indexer not ready → pixel-mode resume on y_norm
    }
    const lineIndex = resolvePosition(saved, lines);
    this.cb.onRestore({ page: saved.page, yNorm: saved.y_norm, lineIndex, rulerEnabled: this.rulerEnabled });
  }

  /**
   * Report a page change. Debounced save; pushes to the jump-back history
   * only when the page differs from the last pushed page.
   */
  reportPage(page: number, lineIndex: number, yNorm: number, snippet: string): void {
    this.schedule('page', { page, lineIndex, yNorm, snippet, fromPage: true });
  }

  /**
   * Report a ruler step. Debounced save; never pushes history
   * (history is page-granular).
   */
  reportRuler(lineIndex: number, yNorm: number, snippet: string): void {
    const page = this.lastKnown?.page ?? 1;
    this.schedule('ruler', { page, lineIndex, yNorm, snippet, fromPage: false });
  }

  /**
   * Toggle the persisted ruler flag. Schedules a debounced save of the
   * last known position so a lone toggle is persisted even without a
   * subsequent page/ruler report.
   */
  setRulerEnabled(on: boolean): void {
    this.rulerEnabled = on;
    if (this.lastKnown) {
      this.schedule('ruler', {
        page: this.lastKnown.page,
        lineIndex: this.lastKnown.line_index,
        yNorm: this.lastKnown.y_norm,
        snippet: this.lastKnown.snippet,
        fromPage: false,
      });
    }
  }

  /** Force-write any pending debounced save(s) immediately. */
  async flush(): Promise<void> {
    const channels: SaveChannel[] = ['page', 'ruler'];
    for (const ch of channels) {
      if (this.timers[ch] !== null) {
        clearTimeout(this.timers[ch]);
        this.timers[ch] = null;
      }
    }
    const writes: Promise<void>[] = [];
    for (const ch of channels) {
      const report = this.pending[ch];
      this.pending[ch] = null; // claim synchronously: timer can't double-fire
      if (report) {
        writes.push(this.persist(report));
      }
    }
    await Promise.all(writes);
  }

  /** Unsubscribe the AppState listener. Call after flush() on unmount. */
  dispose(): void {
    this.appStateSub?.remove();
    this.appStateSub = null;
  }

  /* ---------------- internals ---------------- */

  private schedule(channel: SaveChannel, report: PendingReport): void {
    this.pending[channel] = report;
    if (this.timers[channel] !== null) {
      clearTimeout(this.timers[channel]);
    }
    this.timers[channel] = setTimeout(() => {
      this.timers[channel] = null;
      void this.fire(channel);
    }, RESUME_SAVE_DEBOUNCE_MS);
  }

  private async fire(channel: SaveChannel): Promise<void> {
    const report = this.pending[channel];
    this.pending[channel] = null; // claim synchronously: flush() can't double-write
    if (report) {
      await this.persist(report);
    }
  }

  private async persist(report: PendingReport): Promise<void> {
    const pos: SavedPosition = {
      page: report.page,
      line_index: report.lineIndex,
      y_norm: report.yNorm,
      snippet: report.snippet,
      ruler_enabled: this.rulerEnabled ? 1 : 0,
    };
    this.lastKnown = pos;
    await savePosition(this.bookId, pos);
    if (report.fromPage && report.page !== this.lastHistoryPage) {
      this.lastHistoryPage = report.page;
      await pushHistory(this.bookId, pos);
    }
  }
}

/**
 * React hook wrapper: creates one ResumeController per bookId, keeps the
 * latest callbacks via a ref, and disposes on unmount/book change.
 * (Prefer `key={bookId}` on the reader screen so each book gets a fresh
 * controller rather than relying on the bookId-change path.)
 */
export function useResume(bookId: string, cb: ResumeCallbacks): ResumeController {
  const cbRef = useRef(cb);
  useEffect(() => {
    cbRef.current = cb;
  }, [cb]);

  const [controller] = useState(
    () =>
      new ResumeController(bookId, {
        getLines: (page) => cbRef.current.getLines(page),
        onRestore: (r) => cbRef.current.onRestore(r),
      }),
  );

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  return controller;
}
