/**
 * useRuler.ts — reading-ruler state machine (PRD §6.5).
 *
 * RulerController holds ALL transition logic. It is platform-free
 * (no react-native imports) and unit-tested directly. The useRuler hook
 * below wires it to React, expo-haptics, and persisted settings.
 *
 * Modes:
 *  - text: lines from the page's line index; stepping via navigator.stepLine.
 *  - pixel: image-only (scan) pages; rows from rowProfileToRows over the
 *    engine's get-row-profile response.
 *  - empty: no lines and no rows — the ruler hides and the UI shows
 *    "No text on this page. ▼ to skip." (DESIGN §11); the next ▼/▲ skips
 *    the page (bounded hop loop).
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import type { Line } from '../engine/lines';
import { unionNorm, type NormRect } from '../util/geometry';
import { firstSteppable, lastSteppable, stepLine } from './navigator';
import {
  estimatePixelLineHeight,
  pixelStep,
  rowProfileToRows,
} from './pixelMode';
import {
  DEFAULT_RULER_SETTINGS,
  getRulerSettings,
  setRulerSettings,
  type RulerSettings,
} from './rulerSettings';

/** Engine get-row-profile response, mapped by the reader integration. */
export interface RowProfile {
  rowSums: number[];
  widthPx: number;
}

export interface RulerApi {
  enabled: boolean;
  toggle(): void;
  lines: Line[];
  lineIndex: number | null;
  step(dir: 1 | -1): Promise<void>;
  /** Normalized box of the current line(s), 1–3 per settings. Null when hidden. */
  bandBox: NormRect | null;
}

export interface RulerControllerOpts {
  /** Current reader page (1-based). */
  getPage(): number;
  getLines(page: number): Promise<Line[]>;
  turnPage(delta: 1 | -1): Promise<void>;
  /** Pixel-mode source; omit on runtimes without the engine row profile. */
  getRowProfile?(page: number): Promise<RowProfile>;
  reportRuler(i: number, y: number, s: string): void;
  setRulerEnabled(b: boolean): void;
  /** Called after every successful placement (hook wires haptics here). */
  onStepped?(): void;
}

/** Max pages to skip in one press when parked on empty pages. */
const MAX_EMPTY_HOPS = 20;
/** Resume snippet length (PRD §6.4 stores a short snippet per position). */
const SNIPPET_LEN = 120;

export class RulerController {
  private readonly opts: RulerControllerOpts;
  private readonly listeners = new Set<() => void>();

  enabled = false;
  settings: RulerSettings = { ...DEFAULT_RULER_SETTINGS };

  /** Text lines of the current page (possibly empty). */
  lines: Line[] = [];
  /** Current text line idx; null in pixel mode / when hidden. */
  lineIndex: number | null = null;
  /** Pixel-mode row center (normalized y); null outside pixel mode. */
  pixelY: number | null = null;
  /** True when parked on a page with no text: ruler hidden, UI shows the
   * "No text on this page. ▼ to skip." message (DESIGN §11). */
  emptyPage = false;

  private pixelRows: number[] = [];
  private pixelPage: number | null = null;
  private readonly linesCache = new Map<number, Line[]>();
  private readonly rowCache = new Map<number, number[]>();
  private stepping = false;

  constructor(opts: RulerControllerOpts) {
    this.opts = opts;
  }

  /** Subscribe to placement/setting changes. Returns an unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* listener errors must not break stepping */
      }
    }
  }

  /** Load persisted settings. Call once before first use. */
  async init(): Promise<void> {
    this.settings = await getRulerSettings();
    this.emit();
  }

  /** Persist a partial settings update and apply it live. */
  async updateSettings(patch: Partial<RulerSettings>): Promise<void> {
    this.settings = await setRulerSettings(patch);
    this.emit();
  }

  /** Re-read settings from storage (e.g. after the settings sheet closes). */
  async refreshSettings(): Promise<void> {
    this.settings = await getRulerSettings();
    this.emit();
  }

  toggle(): void {
    void this.setEnabled(!this.enabled);
  }

  /**
   * Resume-restore entry: enable the ruler (if needed) and place it on a
   * specific line of the current page. Falls back to first steppable line,
   * then pixel mode, then hidden — same ladder as landOnPage.
   */
  async restoreToLine(idx: number): Promise<void> {
    if (!this.enabled) {
      this.enabled = true;
      this.opts.setRulerEnabled(true);
    }
    const page = this.opts.getPage();
    const lines = await this.loadLines(page);
    const line = lines.find((l) => l.idx === idx) ?? null;
    if (line) {
      this.placeLine(lines, line.idx);
      return;
    }
    const skip = this.settings.skipHeaders;
    const first = firstSteppable(lines, skip);
    if (first !== null) {
      this.placeLine(lines, first);
      return;
    }
    await this.handleEmptyPage(page, 1);
  }

  private async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    this.opts.setRulerEnabled(on);
    if (on) {
      await this.landOnPage(this.opts.getPage(), 1);
    } else {
      this.lineIndex = null;
      this.pixelY = null;
      this.pixelRows = [];
      this.pixelPage = null;
      this.emptyPage = false;
      this.emit();
    }
  }

  /**
   * Re-land on the current page after a reader-driven page turn
   * (tap zones, drags, scrubber). Ruler-driven cross-page steps land
   * themselves — the reader suppresses reland for those.
   */
  async reland(): Promise<void> {
    if (!this.enabled) return;
    await this.landOnPage(this.opts.getPage(), 1);
  }

  /**
   * Step the ruler one line in `dir`. Guards against re-entrancy so the
   * pill's 6/s long-press repeat can never interleave two steps.
   */
  async step(dir: 1 | -1): Promise<void> {
    if (!this.enabled || this.stepping) return;
    if (dir !== 1 && dir !== -1) {
      throw new Error(`ruler.step: dir must be 1 or -1, got ${String(dir)}`);
    }
    this.stepping = true;
    try {
      const page = this.opts.getPage();

      // Parked on an empty page: ▼/▲ skips to the next/previous page.
      if (this.emptyPage) {
        await this.skipEmptyPage(page, dir);
        return;
      }

      if (this.pixelY !== null) {
        await this.stepPixel(page, dir);
        return;
      }

      const lines = await this.loadLines(page);
      const fromIdx = this.lineIndex ?? (dir === 1 ? -1 : Number.MAX_SAFE_INTEGER);
      const res = stepLine(lines, fromIdx, dir, {
        skipMargins: this.settings.skipHeaders,
      });

      if (res.type === 'line') {
        this.placeLine(lines, res.idx);
        return;
      }
      if (res.type === 'page') {
        const before = page;
        await this.opts.turnPage(res.delta);
        const next = this.opts.getPage();
        if (next === before) return; // book boundary: turnPage was a no-op
        await this.landOnPage(next, res.delta);
        return;
      }
      // {type:'empty'} — no steppable lines on this page.
      await this.handleEmptyPage(page, dir);
    } finally {
      this.stepping = false;
    }
  }

  /**
   * Normalized band box for the current placement, or null when hidden.
   * Covers 1–3 text lines per settings (union of consecutive lines from the
   * current one), plus the configured padding.
   */
  bandBox(): NormRect | null {
    if (!this.enabled) return null;
    const pad = this.settings.padding;
    const clampBox = (b: NormRect): NormRect => ({
      x0: Math.min(1, Math.max(0, b.x0 - pad)),
      y0: Math.min(1, Math.max(0, b.y0 - pad)),
      x1: Math.min(1, Math.max(0, b.x1 + pad)),
      y1: Math.min(1, Math.max(0, b.y1 + pad)),
    });

    if (this.pixelY !== null) {
      const h = estimatePixelLineHeight(this.pixelRows);
      return clampBox({
        x0: 0.06,
        y0: this.pixelY - h / 2,
        x1: 0.94,
        y1: this.pixelY + h / 2,
      });
    }
    if (this.lineIndex === null) return null;
    const ordered = [...this.lines].sort((a, b) => a.idx - b.idx);
    const startPos = ordered.findIndex((l) => l.idx === this.lineIndex);
    if (startPos < 0) return null;
    const slice = ordered.slice(startPos, startPos + this.settings.lines);
    let box = { ...slice[0].box };
    for (const l of slice.slice(1)) box = unionNorm(box, l.box);
    return clampBox(box);
  }

  // ------------------------------------------------------------ internals

  private async loadLines(page: number): Promise<Line[]> {
    const cached = this.linesCache.get(page);
    if (cached) {
      this.lines = cached;
      return cached;
    }
    let lines: Line[] = [];
    try {
      lines = (await this.opts.getLines(page)) ?? [];
    } catch {
      lines = []; // engine/indexer not ready → treat as empty, try pixel
    }
    this.linesCache.set(page, lines);
    this.lines = lines;
    return lines;
  }

  private async loadPixelRows(page: number): Promise<number[]> {
    const cached = this.rowCache.get(page);
    if (cached) return cached;
    let rows: number[] = [];
    try {
      if (this.opts.getRowProfile) {
        const prof = await this.opts.getRowProfile(page);
        rows = rowProfileToRows(prof.rowSums, prof.widthPx);
      }
    } catch {
      rows = [];
    }
    this.rowCache.set(page, rows);
    return rows;
  }

  /** Place the ruler on the first/last steppable line (or pixel row) of a page. */
  private async landOnPage(page: number, dir: 1 | -1): Promise<void> {
    const skip = this.settings.skipHeaders;
    const lines = await this.loadLines(page);
    const idx = dir === 1 ? firstSteppable(lines, skip) : lastSteppable(lines, skip);
    if (idx !== null) {
      this.placeLine(lines, idx);
      return;
    }
    await this.handleEmptyPage(page, dir);
  }

  /** No (steppable) text lines: try pixel mode, else park hidden. */
  private async handleEmptyPage(page: number, dir: 1 | -1): Promise<void> {
    const rows = await this.loadPixelRows(page);
    if (rows.length > 0) {
      this.placePixel(page, rows, dir === 1 ? rows[0] : rows[rows.length - 1]);
      return;
    }
    this.lineIndex = null;
    this.pixelY = null;
    this.emptyPage = true;
    this.emit();
  }

  /** Parked on an empty page: ▼/▲ skips pages until text/rows are found. */
  private async skipEmptyPage(page: number, dir: 1 | -1): Promise<void> {
    const skip = this.settings.skipHeaders;
    let current = page;
    for (let hop = 0; hop < MAX_EMPTY_HOPS; hop++) {
      await this.opts.turnPage(dir);
      const next = this.opts.getPage();
      if (next === current) break; // book boundary
      current = next;
      const lines = await this.loadLines(next);
      const idx =
        dir === 1 ? firstSteppable(lines, skip) : lastSteppable(lines, skip);
      if (idx !== null) {
        this.placeLine(lines, idx);
        return;
      }
      const rows = await this.loadPixelRows(next);
      if (rows.length > 0) {
        this.placePixel(next, rows, dir === 1 ? rows[0] : rows[rows.length - 1]);
        return;
      }
    }
    this.emptyPage = true;
    this.emit();
  }

  private async stepPixel(page: number, dir: 1 | -1): Promise<void> {
    if (this.pixelPage !== page) {
      // Page changed under us (reader-driven turn): re-land.
      await this.landOnPage(page, dir);
      return;
    }
    const res = pixelStep(this.pixelRows, this.pixelY ?? (dir === 1 ? -1 : 2), dir);
    if (res.type === 'row' || res.type === 'fallback') {
      this.placePixel(page, this.pixelRows, res.y);
      return;
    }
    const before = page;
    await this.opts.turnPage(res.delta);
    const next = this.opts.getPage();
    if (next === before) return; // book boundary
    await this.landOnPage(next, res.delta);
  }

  private placeLine(lines: Line[], idx: number): void {
    this.lines = lines;
    this.lineIndex = idx;
    this.pixelY = null;
    this.emptyPage = false;
    const line = lines.find((l) => l.idx === idx);
    const y = line ? (line.box.y0 + line.box.y1) / 2 : 0;
    const snippet = line ? line.text.slice(0, SNIPPET_LEN) : '';
    this.opts.reportRuler(idx, y, snippet);
    this.opts.onStepped?.();
    this.emit();
  }

  private placePixel(page: number, rows: number[], y: number): void {
    this.pixelRows = rows;
    this.pixelPage = page;
    this.pixelY = y;
    this.lineIndex = null;
    this.emptyPage = false;
    // PRD §6.4: scan pages store y_norm only → line_index -1 sentinel.
    this.opts.reportRuler(-1, y, '');
    this.opts.onStepped?.();
    this.emit();
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface RulerOpts {
  bookId: string;
  /** Current reader page (1-based). */
  getPage(): number;
  getLines(page: number): Promise<Line[]>;
  turnPage(delta: 1 | -1): Promise<void>;
  getRowProfile?(page: number): Promise<RowProfile>;
  resume: {
    reportRuler(i: number, y: number, s: string): void;
    setRulerEnabled(b: boolean): void;
  };
  /** Normalized → screen rect (reader provides; includes zoom/pan). */
  toScreen(box: NormRect): { x: number; y: number; width: number; height: number };
}

export interface UseRulerResult extends RulerApi {
  /** Resume-restore: enable + place on a specific line of the current page. */
  restoreToLine(idx: number): Promise<void>;
  /** Re-land after a reader-driven page turn. */
  reland(): Promise<void>;
  settings: RulerSettings;
  updateSettings(patch: Partial<RulerSettings>): Promise<void>;
  refreshSettings(): Promise<void>;
  /** True while parked on a text-less page (UI shows the skip message). */
  emptyPage: boolean;
  /** Pixel-mode row center (normalized y); null outside pixel mode. */
  pixelY: number | null;
  /** False until persisted settings have loaded. */
  ready: boolean;
  /** Reader-provided normalized → screen mapping (zoom/pan aware). */
  toScreen: RulerOpts['toScreen'];
}

/**
 * Owns one RulerController per mount. The caller should key the reader on
 * bookId (or remount this hook) so each book gets a fresh controller.
 *
 * Haptics fire on every placement via a dynamic import so this module stays
 * import-safe on runtimes without the native module (e.g. Node tests).
 */
export function useRuler(opts: RulerOpts): UseRulerResult {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const controllerRef = useRef<RulerController | null>(null);

  const [controller] = useState(() => {
    const c = new RulerController({
      getPage: () => optsRef.current.getPage(),
      getLines: (p) => optsRef.current.getLines(p),
      turnPage: (d) => optsRef.current.turnPage(d),
      getRowProfile: optsRef.current.getRowProfile
        ? (p) => optsRef.current.getRowProfile!(p)
        : undefined,
      reportRuler: (i, y, s) => optsRef.current.resume.reportRuler(i, y, s),
      setRulerEnabled: (b) => optsRef.current.resume.setRulerEnabled(b),
      onStepped: () => {
        const cc = controllerRef.current;
        if (!cc || !cc.settings.haptics) return;
        void import('expo-haptics')
          .then((Haptics) => {
            try {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } catch {
              /* haptics unavailable — ruler still steps */
            }
          })
          .catch(() => {
            /* expo-haptics missing on this runtime */
          });
      },
    });
    controllerRef.current = c;
    return c;
  });

  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void controller.init().then(() => {
      if (alive) setReady(true);
    });
    const off = controller.onChange(() => bump());
    return () => {
      alive = false;
      off();
    };
  }, [controller]);

  // `toScreen` is reader-provided; expose it for the integration snippet.
  const toScreen = (box: NormRect) => optsRef.current.toScreen(box);

  return {
    enabled: controller.enabled,
    toggle: () => controller.toggle(),
    restoreToLine: (idx: number) => controller.restoreToLine(idx),
    reland: () => controller.reland(),
    lines: controller.lines,
    lineIndex: controller.lineIndex,
    step: (dir) => controller.step(dir),
    bandBox: controller.bandBox(),
    settings: controller.settings,
    updateSettings: (p) => controller.updateSettings(p),
    refreshSettings: () => controller.refreshSettings(),
    emptyPage: controller.emptyPage,
    pixelY: controller.pixelY,
    ready,
    toScreen,
  };
}
