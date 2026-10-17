/**
 * ReaderScreen.tsx — the M1 reader (PRD §6.2, DESIGN §6.2 + §8).
 *
 * Single-page paged, fit-width default, zoom 1–5x (pinch + double-tap
 * toggle fit ↔ 2.5x) with pan when zoomed. Tap zones: left 30% prev,
 * right 30% next, center toggles chrome. Horizontal drag at 1x turns the
 * page (M1: 180ms fade; M2 adds curl). Chrome auto-hides after 3s:
 * top bar (back, title, ⋯) + bottom scrubber. Immersive nav bar on mount.
 *
 * Resume (PRD §6.4) is delegated to the ResumeController (useResume):
 * snippet-verified restore, debounced saves, history push on page change,
 * AppState flush. This screen only consumes onRestore (page/yNorm/line)
 * and reports page changes.
 *
 * All animation runs on the UI thread (Reanimated shared values); page
 * pixels come from Skia PageCanvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  Modal,
  PixelRatio,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Canvas as SkiaCanvas, Path as SkiaPath, Rect as SkiaRect, Skia, useImage } from '@shopify/react-native-skia';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as NavigationBar from 'expo-navigation-bar';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { openBookSession, type BookSession, type PageRender } from './bookSession';
import { PageCanvas } from './PageCanvas';
import { Scrubber } from './Scrubber';
import { useResume } from './useResume';
import { ContentsSheet, type HighlightItem } from './ContentsSheet';
import { ExportSheet } from '../export/ExportSheet';
import { StatsSheet } from '../stats/StatsSheet';
import { SearchUI } from '../search/SearchUI';
import { hasBookmarkAtPage, toggleBookmarkAtPage } from '../data/bookmarks';
import { endSession, startSession, SessionTracker } from '../stats/sessions';
import { usePageTurn } from './usePageTurn';
import { PageTurnView } from '../render/PageTurnView';
import { getSetting, SETTINGS_KEYS, type PageAnimationStyle } from '../data/settings';
import { useRuler, type UseRulerResult } from '../ruler/useRuler';
import { RulerOverlay } from '../ruler/RulerOverlay';
import { RulerPill } from '../ruler/RulerPill';
import { AnnotationStore, type Annotation } from '../annotations/store';
import { AnnotationLayer } from '../annotations/renderers';
import {
  AnnotateToolbar,
  useAnnotateGestures,
  type AnnotateTool,
} from '../annotations/AnnotateToolbar';
import { snapSelection } from '../annotations/selection';
import type { NormRect } from '../util/geometry';
import { highlightPalette } from '../theme/tokens';
import { getEngine } from '../engine/engineHost';
import {
  ZOOM_UPGRADE_THRESHOLD,
  clampZoom,
  classifyTapZone,
  doubleTapZoomTarget,
  pickRasterScale,
} from './readerMath';
import { fontFamilies } from '../theme/fonts';
import {
  monoLetterSpacing,
  spacing,
  typeScale,
  type ThemeColors,
} from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

const KEEP_AWAKE_TAG = 'folio-reader';

const CHROME_HIDE_MS = 3000;
const RESUME_CHIP_MS = 2500;
const PAGE_FADE_MS = 180;

export interface ReaderBook {
  id: string;
  title: string | null;
  file_path: string;
}

/** Clamp a translate so the page never leaves empty space at the edges. Worklet. */
function clampOffsets(
  s: number,
  x: number,
  y: number,
  pw: number,
  ph: number,
  vw: number,
  vh: number,
): { x: number; y: number } {
  'worklet';
  const maxX = Math.max(0, (pw * s - vw) / 2);
  const maxY = Math.max(0, (ph * s - vh) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

interface ReaderCallbacks {
  handleTap: (x: number) => void;
  handleDoubleTap: (x: number, y: number) => void;
  onZoomEnd: (s: number) => void;
}

const noopCallbacks: ReaderCallbacks = {
  handleTap: () => undefined,
  handleDoubleTap: () => undefined,
  onZoomEnd: () => undefined,
};

export function ReaderScreen({ book }: { book: ReaderBook }) {
  const { width: vw, height: vh } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // --- theme (M5): the whole chrome reads tokens from the zustand store ---
  const {
    colors: theme,
    name: themeName,
    cycleTheme,
    invertPdf,
    setInvertPdf,
    keepAwake,
    setKeepAwake,
  } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [sessionReady, setSessionReady] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [page, setPage] = useState(1);
  const [render, setRender] = useState<PageRender | null>(null);
  const [renderScale, setRenderScale] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chrome, setChrome] = useState(true);
  const [resumeChip, setResumeChip] = useState<string | null>(null);

  // --- M5 reader chrome additions -----------------------------------------
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState<null | 'menu' | 'contents' | 'stats' | 'export'>(null);
  const [bookmarked, setBookmarked] = useState(false);
  /** Temporary ember outline flashed over a search match / highlight. */
  const [flash, setFlash] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Small toast (auto-downgrade notice, etc.). */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Reading-session tracker (M5 stats). */
  const trackerRef = useRef<SessionTracker | null>(null);

  // --- M2/M3/M4 integration state ------------------------------------------
  /** Page-turn animation style (settings; curl default, slide after auto-downgrade). */
  const [animStyle, setAnimStyle] = useState<PageAnimationStyle>('curl');
  const reducedMotion = useReducedMotion();
  /** Rasters for the turn overlay (set when a turn starts, cleared on commit). */
  const [turnFront, setTurnFront] = useState<string | null>(null);
  const [turnBack, setTurnBack] = useState<string | null>(null);
  /** Waiters resolved when the in-flight animated turn commits/cancels. */
  const turnWaiters = useRef<Array<() => void>>([]);
  /** 'reader' | 'ruler' — who drove the last turn (ruler reland suppression). */
  const turnSource = useRef<'reader' | 'ruler'>('reader');
  /** Pending ruler line placement from resume restore. */
  const [pendingRulerLine, setPendingRulerLine] = useState<number | null>(null);
  /** Annotate mode. */
  const [annotateMode, setAnnotateMode] = useState(false);
  const [annTool, setAnnTool] = useState<AnnotateTool>('highlight');
  const [annColor, setAnnColor] = useState<string>(highlightPalette.yellow);
  const [annOpacity, setAnnOpacity] = useState(1);
  const [penWidth, setPenWidth] = useState(3);
  const [annots, setAnnots] = useState<Annotation[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [fadeById, setFadeById] = useState<Record<string, number>>({});
  const [selRects, setSelRects] = useState<NormRect[]>([]);
  const [strokePreview, setStrokePreview] = useState<Array<{ x: number; y: number }>>([]);
  const [noteAnchor, setNoteAnchor] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState('');
  const selectionRef = useRef<{ anchor: { x: number; y: number }; rects: NormRect[] } | null>(null);
  const strokeRef = useRef<Array<{ x: number; y: number }>>([]);
  const annStore = useMemo(() => new AnnotationStore(book.id), [book.id]);

  const sessionRef = useRef<BookSession | null>(null);
  const pageRef = useRef(1);
  const pageCountRef = useRef(1);
  const pageHRef = useRef(0);
  const lineIndexRef = useRef(0);
  const snippetRef = useRef('');
  const pendingYNormRef = useRef<number | null>(null);
  const renderRef = useRef<PageRender | null>(null);
  const renderScaleRef = useRef(1);
  const rulerRef = useRef<UseRulerResult | null>(null);

  /** Small toast helper. */
  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // --- UI-thread values -------------------------------------------------
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const pageOpacity = useSharedValue(0);
  const chromeOpacity = useSharedValue(1);
  const vwSV = useSharedValue(vw);
  const vhSV = useSharedValue(vh);
  const pageWSV = useSharedValue(vw);
  const pageHSV = useSharedValue(vh);
  const pinchCtx = useSharedValue({ s: 1, x: 0, y: 0 });
  const panCtx = useSharedValue({ x: 0, y: 0 });

  useEffect(() => {
    vwSV.value = vw;
    vhSV.value = vh;
  }, [vw, vh, vwSV, vhSV]);

  useEffect(() => {
    chromeOpacity.value = withTiming(chrome ? 1 : 0, { duration: 180 });
  }, [chrome, chromeOpacity]);

  // --- resume (PRD §6.4, via the resume agent's controller) --------------
  const resume = useResume(book.id, {
    getLines: (p) => sessionRef.current?.getPageLines(p) ?? Promise.resolve([]),
    onRestore: ({ page: rp, yNorm, lineIndex, rulerEnabled }) => {
      const s = sessionRef.current;
      const target = s ? Math.min(s.pageCount, Math.max(1, rp)) : rp;
      pageRef.current = target;
      setPage(target);
      lineIndexRef.current = lineIndex ?? 0;
      pendingYNormRef.current = yNorm;
      // Snippet for the resolved line (session caches lines, so this is cheap).
      void sessionRef.current
        ?.getPageLines(target)
        .then((lines) => {
          snippetRef.current = lines[lineIndex ?? 0]?.text.slice(0, 48) ?? '';
        })
        .catch(() => undefined);
      if (target !== 1 || yNorm > 0.001 || (lineIndex ?? 0) > 0) {
        setResumeChip(`Resumed · p.${target}, line ${(lineIndex ?? 0) + 1}`);
      }
      // Restore the ruler where it was (the hook places it once ready).
      if (rulerEnabled && lineIndex != null) {
        setPendingRulerLine(lineIndex);
      }
    },
  });

  /** Current vertical read position as y_norm (0 = top, 1 = bottom). */
  const yNormNow = (): number => {
    const ph = pageHRef.current;
    return ph > vh ? Math.min(1, Math.max(0, 0.5 - ty.value / (ph - vh))) : 0;
  };

  // --- M2: page-turn animation (Skia curl/slide/fade) -------------------------
  // Gate: the turn gesture only drives when the page is at fit-width and
  // annotate mode is off (pinch/double-tap update it; annotate toggles it).
  const turnEnabled = useSharedValue(true);
  useEffect(() => {
    turnEnabled.value = !annotateMode;
  }, [annotateMode, turnEnabled]);

  // Commit body, assigned each render (needs `turn`, defined below).
  const doCommitTurn = useRef((t: number) => undefined as void);

  const turn = usePageTurn({
    pageWidth: vw,
    style: animStyle,
    reducedMotion,
    enabled: turnEnabled,
    onCommit: (dir) => {
      const t = pageRef.current + dir;
      const waiters = turnWaiters.current;
      turnWaiters.current = [];
      const done = () => {
        for (const w of waiters) {
          try {
            w();
          } catch {
            /* ignore */
          }
        }
      };
      if (t < 1 || t > pageCountRef.current) {
        turn.cancelTurn();
        done();
        return;
      }
      doCommitTurn.current(t);
      done();
    },
    onCancel: () => {
      const waiters = turnWaiters.current;
      turnWaiters.current = [];
      for (const w of waiters) {
        try {
          w();
        } catch {
          /* ignore */
        }
      }
      setTurnFront(null);
      setTurnBack(null);
    },
    recordFrameTime: () => undefined,
    onDowngrade: () => {
      setAnimStyle('slide');
      showToast('Page animation simplified for smoothness');
    },
    onDirectionLatch: (dir) => {
      // Preload the back-page raster the moment the drag direction is known.
      setTurnFront(renderRef.current?.path ?? null);
      const t = pageRef.current + dir;
      if (t >= 1 && t <= pageCountRef.current) {
        void sessionRef.current
          ?.getPageImage(t, renderScaleRef.current)
          .then((r) => setTurnBack(r.path))
          .catch(() => setTurnBack(null));
      } else {
        setTurnBack(null);
      }
    },
  });

  doCommitTurn.current = (t: number) => {
    resume.reportPage(pageRef.current, lineIndexRef.current, yNormNow(), snippetRef.current);
    trackerRef.current?.recordPage(t);
    pageRef.current = t;
    setPage(t);
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    turn.progress.value = 0;
    setTurnFront(null);
    setTurnBack(null);
  };

  /**
   * Animated programmatic turn (tap zones, ruler cross-page). Resolves when
   * the page index actually advances. Falls back to the fade jump when the
   * back raster can't be prepared.
   */
  const animatedTurnTo = useCallback(
    async (t: number, source: 'reader' | 'ruler' = 'reader'): Promise<void> => {
      const s = sessionRef.current;
      if (!s) return;
      const bounded = Math.min(pageCountRef.current, Math.max(1, Math.floor(t)));
      if (bounded === pageRef.current) return;
      const dir: 1 | -1 = bounded > pageRef.current ? 1 : -1;
      turnSource.current = source;
      setTurnFront(renderRef.current?.path ?? null);
      try {
        const r = await s.getPageImage(bounded, renderScaleRef.current);
        setTurnBack(r.path);
      } catch {
        // Raster unavailable — fall back to the fade jump.
        setTurnFront(null);
        setTurnBack(null);
        goToPage(bounded);
        return;
      }
      await new Promise<void>((resolve) => {
        turnWaiters.current.push(resolve);
        turn.runAnimatedTurn(dir);
      });
    },
    // goToPage defined below; called only in the fallback path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const turnFrontImage = useImage(turnFront ? `file://${turnFront}` : null);
  const turnBackImage = useImage(turnBack ? `file://${turnBack}` : null);

  // Load the persisted animation style once.
  useEffect(() => {
    void getSetting<PageAnimationStyle>(SETTINGS_KEYS.PAGE_ANIMATION, 'curl')
      .then(setAnimStyle)
      .catch(() => undefined);
  }, []);

  // --- page navigation ----------------------------------------------------
  const swapPage = useCallback(
    (target: number) => {
      pageRef.current = target;
      setPage(target);
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
      // fade back in once the new raster loads (render effect below)
    },
    [scale, tx, ty],
  );

  const goToPage = useCallback(
    (target: number) => {
      const t = Math.min(pageCountRef.current, Math.max(1, Math.floor(target)));
      if (t === pageRef.current) return;
      turnSource.current = 'reader';
      // Report the page being left; the controller debounces + pushes history.
      resume.reportPage(pageRef.current, lineIndexRef.current, yNormNow(), snippetRef.current);
      trackerRef.current?.recordPage(t);
      pageOpacity.value = withTiming(0, { duration: PAGE_FADE_MS / 2 }, (finished) => {
        if (finished) runOnJS(swapPage)(t);
      });
    },
    // yNormNow reads refs/shared values; vh/ty listed for correctness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageOpacity, resume, swapPage, vh, ty],
  );

  const commitSwipe = useCallback(
    (dir: 1 | -1) => {
      goToPage(pageRef.current + dir);
    },
    [goToPage],
  );

  const onZoomEnd = useCallback((s: number) => {
    // PRD §7.3: render at 1x, upgrade to 2x when zoomed.
    if (s > ZOOM_UPGRADE_THRESHOLD) {
      setRenderScale((cur) => (cur < 2 ? 2 : cur));
    }
  }, []);

  const handleTap = useCallback(
    (x: number) => {
      if (annotateMode) return; // taps are handled by the annotate layer
      const zone = classifyTapZone(x, vw);
      if (zone === 'prev') void animatedTurnTo(pageRef.current - 1);
      else if (zone === 'next') void animatedTurnTo(pageRef.current + 1);
      else setChrome((c) => !c);
    },
    [vw, annotateMode, animatedTurnTo],
  );

  const handleDoubleTap = useCallback(
    (x: number, y: number) => {
      const target = doubleTapZoomTarget(scale.value);
      const cx = vw / 2;
      const cy = vh / 2;
      const ratio = target / scale.value;
      if (target === 1) {
        scale.value = withTiming(1, { duration: 200 });
        tx.value = withTiming(0, { duration: 200 });
        ty.value = withTiming(0, { duration: 200 });
      } else {
        tx.value = withTiming(x - cx - (x - cx - tx.value) * ratio, { duration: 200 });
        ty.value = withTiming(y - cy - (y - cy - ty.value) * ratio, { duration: 200 });
        scale.value = withTiming(target, { duration: 200 });
      }
      onZoomEnd(target);
    },
    [vw, vh, scale, tx, ty, onZoomEnd],
  );

  const jumpToPageStart = useCallback(() => {
    const ph = pageHRef.current;
    const targetTy = ph > vh ? (ph - vh) / 2 : 0;
    scale.value = withTiming(1, { duration: 200 });
    tx.value = withTiming(0, { duration: 200 });
    ty.value = withTiming(targetTy, { duration: 200 });
    setResumeChip(null);
  }, [vh, scale, tx, ty]);

  // --- M5: match / annotation flash ------------------------------------------
  /** Flash an ember outline over a normalized page rect (search/TOC jumps). */
  const flashNormRect = useCallback(
    (box: { x0: number; y0: number; x1: number; y1: number } | null) => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (!box) {
        setFlash(null);
        return;
      }
      // pageW === vw always; pageH comes from the ref (both declared below).
      const pw = vw;
      const ph = pageHRef.current > 0 ? pageHRef.current : vh;
      setFlash({
        x: box.x0 * pw,
        y: box.y0 * ph,
        w: Math.max(8, (box.x1 - box.x0) * pw),
        h: Math.max(10, (box.y1 - box.y0) * ph),
      });
      flashTimer.current = setTimeout(() => setFlash(null), 1400);
    },
    [vw, vh],
  );

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  /** Search jump: turn the page, then flash the first line holding the query. */
  const jumpToSearchMatch = useCallback(
    (target: number, query: string) => {
      goToPage(target);
      const token = query.split(/\s+/).filter(Boolean)[0]?.toLowerCase();
      if (!token) return;
      // Wait a beat for the new raster, then locate the line.
      setTimeout(() => {
        sessionRef.current
          ?.getPageLines(target)
          .then((lines) => {
            const hit = lines.find((l) => l.text.toLowerCase().includes(token));
            if (hit) flashNormRect(hit.box);
          })
          .catch(() => undefined);
      }, 350);
    },
    [goToPage, flashNormRect],
  );

  /** Highlight tap: jump to its page and pulse the annotation rect. */
  const handleSelectHighlight = useCallback(
    (item: HighlightItem) => {
      setSheet(null);
      goToPage(item.page);
      const r = item.rects[0];
      if (r) {
        setTimeout(() => flashNormRect(r), 350);
      }
    },
    [goToPage, flashNormRect],
  );

  // --- M5: bookmarks ------------------------------------------------------------
  useEffect(() => {
    if (!sessionReady) return;
    hasBookmarkAtPage(book.id, page)
      .then(setBookmarked)
      .catch(() => undefined);
  }, [book.id, page, sessionReady]);

  const toggleBookmark = useCallback(() => {
    toggleBookmarkAtPage(book.id, pageRef.current)
      .then(setBookmarked)
      .catch(() => undefined);
  }, [book.id]);

  // --- M5: overflow menu ----------------------------------------------------------
  const openMenu = useCallback(() => {
    setSheet('menu');
  }, []);

  // --- M5: reading-session tracking (PRD §6.11) -------------------------------------
  // One DB session per foreground stretch: backgrounding ends the row
  // (persisting wall-time minus backgrounded gaps); foreground starts a fresh
  // tracker so totals can never double-count across stretches.
  useEffect(() => {
    let cancelled = false;
    let tracker: SessionTracker | null = null;
    let sessionId: number | null = null;
    let appStateSub: { remove: () => void } | null = null;

    const beginSession = () => {
      tracker = new SessionTracker();
      tracker.start(pageRef.current);
      trackerRef.current = tracker;
      startSession(book.id)
        .then((id) => {
          if (!cancelled) sessionId = id;
        })
        .catch(() => undefined);
    };
    const finishSession = () => {
      const t = tracker;
      const id = sessionId;
      tracker = null;
      sessionId = null;
      trackerRef.current = null;
      if (t && id != null) {
        endSession(id, t.finish()).catch(() => undefined);
      }
    };

    beginSession();
    appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        finishSession();
      } else if (state === 'active') {
        beginSession();
      }
    });

    return () => {
      cancelled = true;
      appStateSub?.remove();
      finishSession();
    };
  }, [book.id]);

  // --- M5: keep-awake (expo-keep-awake; deactivated on unmount) -----------------------
  useEffect(() => {
    if (keepAwake) {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    }
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [keepAwake]);

  const callbacks = useRef<ReaderCallbacks>(noopCallbacks);
  callbacks.current = { handleTap, handleDoubleTap, onZoomEnd };

  // Stable JS entry points for runOnJS (gestures are created once).
  const handleTapJS = (x: number): void => {
    callbacks.current.handleTap(x);
  };
  const handleDoubleTapJS = (x: number, y: number): void => {
    callbacks.current.handleDoubleTap(x, y);
  };
  const onZoomEndJS = (s: number): void => {
    callbacks.current.onZoomEnd(s);
  };

  // --- M2/M3/M4: overlay geometry + controllers -------------------------------
  // Page size on screen (moved up: gestures and overlays need it).
  const pageW = vw;
  const pageH = render && render.widthPx > 0 ? (vw * render.heightPx) / render.widthPx : vh;

  /** Normalized page box → screen rect, zoom/pan aware. */
  const toScreenBox = useCallback(
    (box: NormRect): { x: number; y: number; width: number; height: number } => {
      const s = scale.value;
      const ox = tx.value;
      const oy = ty.value;
      const left = (vw - pageW) / 2;
      const top = (vh - pageH) / 2;
      const px = (nx: number) => left + pageW / 2 + (nx * pageW - pageW / 2) * s + ox;
      const py = (ny: number) => top + pageH / 2 + (ny * pageH - pageH / 2) * s + oy;
      const x0 = px(box.x0);
      const x1 = px(box.x1);
      const y0 = py(box.y0);
      const y1 = py(box.y1);
      return {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      };
    },
    [vw, vh, pageW, pageH, scale, tx, ty],
  );

  /** Normalized page box → page-LOCAL rect (for layers inside the transformed pageWrap). */
  const toScreenPlain = useCallback(
    (box: NormRect): { x0: number; y0: number; x1: number; y1: number } | null => ({
      x0: box.x0 * pageW,
      y0: box.y0 * pageH,
      x1: box.x1 * pageW,
      y1: box.y1 * pageH,
    }),
    [pageW, pageH],
  );

  /** Live pen-stroke preview path (page-local coords). */
  const strokePathPreview = useMemo(() => {
    const builder = Skia.PathBuilder.Make();
    if (strokePreview.length > 0) {
      builder.moveTo(strokePreview[0].x * pageW, strokePreview[0].y * pageH);
      for (let i = 1; i < strokePreview.length; i++) {
        builder.lineTo(strokePreview[i].x * pageW, strokePreview[i].y * pageH);
      }
    }
    return builder.detach();
  }, [strokePreview, pageW, pageH]);

  /** Screen touch → normalized page coords (for selection / pen / eraser). */
  const touchToNorm = useCallback(
    (x: number, y: number): { x: number; y: number } => {
      const s = Math.max(0.001, scale.value);
      const left = (vw - pageW) / 2;
      const top = (vh - pageH) / 2;
      const lx = (x - left - pageW / 2 - tx.value) / s + pageW / 2;
      const ly = (y - top - pageH / 2 - ty.value) / s + pageH / 2;
      return {
        x: Math.min(1, Math.max(0, lx / pageW)),
        y: Math.min(1, Math.max(0, ly / pageH)),
      };
    },
    [vw, vh, pageW, pageH, scale, tx, ty],
  );

  // --- M3: reading ruler -------------------------------------------------------
  const ruler = useRuler({
    bookId: book.id,
    getPage: () => pageRef.current,
    getLines: (p) => sessionRef.current?.getPageLines(p) ?? Promise.resolve([]),
    turnPage: (d) => animatedTurnTo(pageRef.current + d, 'ruler'),
    getRowProfile: (p) => getEngine().getRowProfile(p, 0.25),
    resume: {
      reportRuler: (i, y, s) => resume.reportRuler(i, y, s),
      setRulerEnabled: (b) => resume.setRulerEnabled(b),
    },
    toScreen: toScreenBox,
  });

  useEffect(() => {
    rulerRef.current = ruler;
  });

  // Reader-driven page turns re-land the ruler; ruler-driven ones land themselves.
  useEffect(() => {
    if (turnSource.current === 'reader') {
      void rulerRef.current?.reland();
    }
    turnSource.current = 'reader';
  }, [page]);

  // Pending resume placement once the ruler is ready.
  useEffect(() => {
    if (pendingRulerLine != null && ruler.ready) {
      const idx = pendingRulerLine;
      setPendingRulerLine(null);
      void ruler.restoreToLine(idx).catch(() => undefined);
    }
  }, [pendingRulerLine, ruler]);

  const toggleRulerJS = (): void => {
    rulerRef.current?.toggle();
  };

  // --- M4: annotations -----------------------------------------------------------
  const refreshAnnots = useCallback(async () => {
    try {
      setAnnots(await annStore.listAnnotations(pageRef.current));
      setCanUndo(await annStore.canUndo());
      setCanRedo(await annStore.canRedo());
    } catch {
      /* store unavailable — annotations degrade silently */
    }
  }, [annStore]);

  useEffect(() => {
    if (sessionReady) void refreshAnnots();
  }, [page, sessionReady, refreshAnnots]);

  /** Enter/exit annotate mode (toolbar swap + gesture swap). */
  const setAnnotateModeOn = useCallback(
    (on: boolean) => {
      setAnnotateMode(on);
      turnEnabled.value = !on;
      if (on) {
        setChrome(true);
        void refreshAnnots();
      }
    },
    [refreshAnnots, turnEnabled],
  );

  const doUndo = useCallback(async () => {
    try {
      const affected = await annStore.undo();
      if (affected && affected.length > 0) {
        // 140 ms fade-out, then refresh (DESIGN §7).
        const ids: Record<string, number> = {};
        for (const a of affected) ids[a.id] = 0;
        setFadeById(ids);
        setTimeout(() => {
          setFadeById({});
          void refreshAnnots();
        }, 140);
      } else {
        await refreshAnnots();
      }
    } catch {
      /* ignore */
    }
  }, [annStore, refreshAnnots]);

  const doRedo = useCallback(async () => {
    try {
      const affected = await annStore.redo();
      if (affected && affected.length > 0) {
        const ids: Record<string, number> = {};
        for (const a of affected) ids[a.id] = 1;
        setFadeById(ids);
        setTimeout(() => {
          setFadeById({});
          void refreshAnnots();
        }, 140);
      } else {
        await refreshAnnots();
      }
    } catch {
      /* ignore */
    }
  }, [annStore, refreshAnnots]);

  const annotateGestures = useAnnotateGestures({
    enabled: annotateMode,
    onUndo: () => void doUndo(),
    onRedo: () => void doRedo(),
  });

  /** Begin a selection stroke / pen stroke / eraser dab (annotate mode). */
  const annotatePanStartJS = (x: number, y: number): void => {
    const p = touchToNorm(x, y);
    if (annTool === 'pen') {
      strokeRef.current = [p];
      setStrokePreview([p]);
    } else if (annTool === 'highlight' || annTool === 'underline' || annTool === 'strike') {
      selectionRef.current = { anchor: p, rects: [] };
      setSelRects([]);
    } else if (annTool === 'eraser') {
      void annStore.eraseAt(pageRef.current, p, 0.02).then(refreshAnnots).catch(() => undefined);
    }
  };

  /** Extend the in-progress stroke / selection. */
  const annotatePanUpdateJS = (x: number, y: number): void => {
    const p = touchToNorm(x, y);
    if (annTool === 'pen') {
      strokeRef.current.push(p);
      setStrokePreview([...strokeRef.current]);
    } else if (
      (annTool === 'highlight' || annTool === 'underline' || annTool === 'strike') &&
      selectionRef.current
    ) {
      const sel = selectionRef.current;
      void sessionRef.current
        ?.getPageLines(pageRef.current)
        .then((lines) => {
          const rects = snapSelection(lines, sel.anchor, p);
          sel.rects = rects;
          setSelRects(rects);
        })
        .catch(() => undefined);
    } else if (annTool === 'eraser') {
      void annStore.eraseAt(pageRef.current, p, 0.02).then(refreshAnnots).catch(() => undefined);
    }
  };

  /** Finish the stroke / selection and persist it (op-logged). */
  const annotatePanEndJS = (): void => {
    if (annTool === 'pen' && strokeRef.current.length > 1) {
      const polyline = strokeRef.current;
      strokeRef.current = [];
      setStrokePreview([]);
      void annStore
        .addAnnotation({
          book_id: book.id,
          page: pageRef.current,
          type: 'pen',
          color: annColor,
          opacity: annOpacity,
          dataJson: { polyline, width: penWidth },
          note: null,
        })
        .then(() => refreshAnnots())
        .catch(() => undefined);
    } else if (
      (annTool === 'highlight' || annTool === 'underline' || annTool === 'strike') &&
      selectionRef.current
    ) {
      const rects = selectionRef.current.rects;
      selectionRef.current = null;
      setSelRects([]);
      if (rects.length > 0) {
        void annStore
          .addAnnotation({
            book_id: book.id,
            page: pageRef.current,
            type: annTool,
            color: annColor,
            opacity: annOpacity,
            dataJson: { rects },
            note: null,
          })
          .then(() => refreshAnnots())
          .catch(() => undefined);
      }
    }
  };

  /** Tap in annotate mode: note placement or select-tool actions. */
  const annotateTapJS = (x: number, y: number): void => {
    const p = touchToNorm(x, y);
    if (annTool === 'note') {
      setNoteAnchor(p);
      setNoteText('');
      return;
    }
    if (annTool === 'select') {
      void (async () => {
        const list = await annStore.listAnnotations(pageRef.current).catch(() => []);
        const hit = list.find((a) => {
          const rects = a.dataJson.rects ?? [];
          if (rects.some((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1)) return true;
          const anchor = a.dataJson.noteAnchor;
          if (anchor && Math.hypot(anchor.x - p.x, anchor.y - p.y) < 0.03) return true;
          const poly = a.dataJson.polyline;
          if (poly && poly.some((pt) => Math.hypot(pt.x - p.x, pt.y - p.y) < 0.02)) return true;
          return false;
        });
        if (!hit) return;
        // Minimal select actions (full move/recolor UI is a follow-up).
        const { Alert } = await import('react-native');
        Alert.alert('Annotation', `${hit.type} · p.${hit.page}`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => void annStore.deleteAnnotation(hit.id).then(() => refreshAnnots()),
          },
        ]);
      })();
    }
  };

  const saveNote = useCallback(() => {
    if (!noteAnchor) return;
    const anchor = noteAnchor;
    const text = noteText.trim();
    setNoteAnchor(null);
    setNoteText('');
    if (!text) return;
    void annStore
      .addAnnotation({
        book_id: book.id,
        page: pageRef.current,
        type: 'note',
        color: annColor,
        opacity: 1,
        dataJson: { noteAnchor: anchor },
        note: text,
      })
      .then(() => refreshAnnots())
      .catch(() => undefined);
  }, [noteAnchor, noteText, annStore, annColor, refreshAnnots]);

  // --- gestures -------------------------------------------------------------
  const pinch = useRef(
    Gesture.Pinch()
      .onStart(() => {
        'worklet';
        pinchCtx.value = { s: scale.value, x: tx.value, y: ty.value };
      })
      .onUpdate((e) => {
        'worklet';
        const ctx = pinchCtx.value;
        const next = clampZoom(ctx.s * e.scale);
        const ratio = next / scale.value;
        const cx = vwSV.value / 2;
        const cy = vhSV.value / 2;
        tx.value = e.focalX - cx - (e.focalX - cx - tx.value) * ratio;
        ty.value = e.focalY - cy - (e.focalY - cy - ty.value) * ratio;
        scale.value = next;
      })
      .onEnd(() => {
        'worklet';
        if (scale.value < 1.05) {
          scale.value = withTiming(1, { duration: 180 });
          tx.value = withTiming(0, { duration: 180 });
          ty.value = withTiming(0, { duration: 180 });
        } else {
          const c = clampOffsets(
            scale.value,
            tx.value,
            ty.value,
            pageWSV.value,
            pageHSV.value,
            vwSV.value,
            vhSV.value,
          );
          tx.value = withTiming(c.x, { duration: 180 });
          ty.value = withTiming(c.y, { duration: 180 });
          runOnJS(onZoomEndJS)(scale.value);
        }
      }),
  ).current;

  const pan = useRef(
    Gesture.Pan()
      .onStart(() => {
        'worklet';
        panCtx.value = { x: tx.value, y: ty.value };
      })
      .onUpdate((e) => {
        'worklet';
        const ctx = panCtx.value;
        if (scale.value > 1) {
          const c = clampOffsets(
            scale.value,
            ctx.x + e.translationX,
            ctx.y + e.translationY,
            pageWSV.value,
            pageHSV.value,
            vwSV.value,
            vhSV.value,
          );
          tx.value = c.x;
          ty.value = c.y;
        } else {
          // Fit-width: horizontal drags belong to the page-turn gesture;
          // vertical drag pans a page taller than the viewport.
          const c = clampOffsets(
            1,
            0,
            ctx.y + e.translationY,
            pageWSV.value,
            pageHSV.value,
            vwSV.value,
            vhSV.value,
          );
          ty.value = c.y;
        }
      })
      .onEnd(() => {
        'worklet';
        const c = clampOffsets(
          scale.value,
          tx.value,
          ty.value,
          pageWSV.value,
          pageHSV.value,
          vwSV.value,
          vhSV.value,
        );
        tx.value = withTiming(c.x, { duration: 180 });
        ty.value = withTiming(c.y, { duration: 180 });
      }),
  ).current;

  const tap = useRef(
    Gesture.Tap()
      .numberOfTaps(1)
      .onEnd((e) => {
        'worklet';
        runOnJS(handleTapJS)(e.x);
      }),
  ).current;

  const doubleTap = useRef(
    Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(350)
      .onEnd((e) => {
        'worklet';
        runOnJS(handleDoubleTapJS)(e.x, e.y);
      }),
  ).current;

  const longPress = useRef(
    Gesture.LongPress()
      .minDuration(500)
      .onEnd(() => {
        'worklet';
        runOnJS(toggleRulerJS)();
      }),
  ).current;

  const composed = useRef(
    Gesture.Simultaneous(
      pinch,
      pan,
      turn.gesture,
      Gesture.Exclusive(longPress, doubleTap, tap),
    ),
  ).current;

  // Annotate mode: selection/pen/eraser gestures replace navigation.
  const annotatePan = useRef(
    Gesture.Pan()
      .onStart((e) => {
        'worklet';
        runOnJS(annotatePanStartJS)(e.x, e.y);
      })
      .onUpdate((e) => {
        'worklet';
        runOnJS(annotatePanUpdateJS)(e.x, e.y);
      })
      .onEnd(() => {
        'worklet';
        runOnJS(annotatePanEndJS)();
      }),
  ).current;

  const annotateTap = useRef(
    Gesture.Tap()
      .onEnd((e) => {
        'worklet';
        runOnJS(annotateTapJS)(e.x, e.y);
      }),
  ).current;

  const annotateComposed = useRef(
    Gesture.Simultaneous(pinch, annotatePan, annotateTap, annotateGestures),
  ).current;

  // --- session lifecycle ----------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setSessionReady(false);
    openBookSession({ id: book.id, file_path: book.file_path })
      .then(async (s) => {
        if (cancelled) {
          await s.close().catch(() => undefined);
          return;
        }
        sessionRef.current = s;
        pageCountRef.current = s.pageCount;
        setPageCount(s.pageCount);
        try {
          const geom = await s.getPageGeom(1);
          if (!cancelled) {
            setRenderScale(pickRasterScale(geom.widthPt, vw * PixelRatio.get()));
          }
        } catch {
          // keep raster scale 1
        }
        if (cancelled) return;
        setSessionReady(true);
        // Restore the saved position (snippet-verified by the controller).
        void resume.restore().catch(() => undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "That file didn't open.");
        }
      });
    return () => {
      cancelled = true;
      void resume.flush();
      const s = sessionRef.current;
      sessionRef.current = null;
      if (s) void s.close().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.file_path, resume]);

  // --- raster loading ---------------------------------------------------------
  // (pageW/pageH are computed in the overlay section above — gestures need them.)

  useEffect(() => {
    pageWSV.value = pageW;
    pageHSV.value = pageH;
    pageHRef.current = pageH;
  }, [pageW, pageH, pageWSV, pageHSV]);

  useEffect(() => {
    const s = sessionRef.current;
    if (!s || !sessionReady) return;
    let cancelled = false;
    setRender(null);
    s.getPageImage(page, renderScale)
      .then((r) => {
        if (cancelled) return;
        setRender(r);
        // Apply a restored y_norm now that the page height is known.
        const pending = pendingYNormRef.current;
        if (pending != null) {
          pendingYNormRef.current = null;
          const ph = vw * (r.heightPx / r.widthPx);
          if (ph > vh) {
            ty.value = (ph - vh) * (0.5 - Math.min(1, Math.max(0, pending)));
          }
        }
        pageOpacity.value = withTiming(1, { duration: PAGE_FADE_MS / 2 });
      })
      .catch(() => {
        if (!cancelled) setLoadError('That page didn’t render. Try again.');
      });
    s.prefetch(page, renderScale);
    return () => {
      cancelled = true;
    };
  }, [page, renderScale, sessionReady, vw, vh, pageOpacity, ty]);

  // --- chrome auto-hide ---------------------------------------------------------
  // (stays visible in annotate mode so the toolbar never disappears mid-stroke)
  useEffect(() => {
    if (!chrome || annotateMode) return;
    const t = setTimeout(() => setChrome(false), CHROME_HIDE_MS);
    return () => clearTimeout(t);
  }, [chrome, annotateMode]);

  // --- resume chip auto-dismiss ---------------------------------------------------
  useEffect(() => {
    if (!resumeChip) return;
    const t = setTimeout(() => setResumeChip(null), RESUME_CHIP_MS);
    return () => clearTimeout(t);
  }, [resumeChip]);

  // --- immersive mode -----------------------------------------------------------------
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setVisibilityAsync('hidden').catch(() => undefined);
    return () => {
      NavigationBar.setVisibilityAsync('visible').catch(() => undefined);
    };
  }, []);

  // --- animated styles ------------------------------------------------------------------
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    opacity: pageOpacity.value,
  }));

  const chromeAnimStyle = useAnimatedStyle(() => ({
    opacity: chromeOpacity.value,
  }));

  const title = book.title && book.title.trim().length > 0 ? book.title : 'Untitled';

  return (
    <View style={styles.root}>
      <GestureDetector gesture={annotateMode ? annotateComposed : composed}>
        <Animated.View style={styles.pageArea}>
          <Animated.View
            style={[
              styles.pageWrap,
              { width: pageW, height: pageH, left: (vw - pageW) / 2, top: (vh - pageH) / 2 },
              pageStyle,
            ]}
          >
            <PageCanvas
              path={render ? render.path : null}
              width={pageW}
              height={pageH}
              placeholderColor={theme.surface}
              fadeMs={PAGE_FADE_MS}
              invert={invertPdf}
            />
            {/* M4: annotation overlay (Skia, inherits the page zoom/pan transform) */}
            {annots.length > 0 || selRects.length > 0 || strokePreview.length > 0 ? (
              <SkiaCanvas
                style={{ position: 'absolute', width: pageW, height: pageH }}
                pointerEvents="none"
              >
                <AnnotationLayer
                  annotations={annots}
                  toScreen={toScreenPlain}
                  fadeById={fadeById}
                />
                {/* live selection preview */}
                {selRects.map((r, i) => {
                  const b = toScreenPlain(r);
                  if (!b) return null;
                  return (
                    <SkiaRect
                      key={`sel-${i}`}
                      x={b.x0}
                      y={b.y0}
                      width={Math.max(1, b.x1 - b.x0)}
                      height={Math.max(1, b.y1 - b.y0)}
                      color={annColor}
                      opacity={0.35}
                    />
                  );
                })}
                {/* live pen stroke preview */}
                {strokePreview.length > 1 ? (
                  <SkiaPath
                    path={strokePathPreview}
                    color={annColor}
                    opacity={annOpacity}
                    style="stroke"
                    strokeWidth={penWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                ) : null}
              </SkiaCanvas>
            ) : null}
            {/* ember flash over a search match / highlight (M5) */}
            {flash ? (
              <View
                pointerEvents="none"
                style={[
                  styles.flash,
                  {
                    left: flash.x,
                    top: flash.y,
                    width: flash.w,
                    height: flash.h,
                    borderColor: theme.accent,
                    backgroundColor: theme.accent,
                  },
                ]}
              />
            ) : null}
          </Animated.View>

          {/* M2: page-turn overlay (curl/slide/fade) — transparent at rest */}
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <PageTurnView
              frontImage={turnFrontImage}
              backImage={turnBackImage}
              progress={turn.progress}
              direction={turn.direction}
              style={animStyle}
              pageSize={{ w: pageW, h: pageH }}
              reducedMotion={reducedMotion}
            />
          </View>

          {/* M3: reading ruler */}
          <RulerOverlay
            box={ruler.bandBox ? ruler.toScreen(ruler.bandBox) : null}
            visible={ruler.enabled}
            style={ruler.settings.style}
            color={ruler.settings.color}
            fillAlpha={ruler.settings.opacity}
            glide={ruler.settings.glide}
            pageKey={page}
          />
          <RulerPill
            visible={ruler.enabled}
            lineIndex={ruler.lineIndex}
            totalLines={ruler.lines.length}
            onStep={(d) => void ruler.step(d)}
            side={ruler.settings.side}
            onSideChange={(s) => void ruler.updateSettings({ side: s })}
          />
          {ruler.enabled && ruler.emptyPage ? (
            <View style={styles.rulerEmpty} pointerEvents="none">
              <Text style={styles.rulerEmptyText}>No text on this page. ▼ to skip.</Text>
            </View>
          ) : null}

          {loadError ? (
            <View style={styles.centerOverlay} pointerEvents="box-none">
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{loadError}</Text>
                <Pressable
                  style={styles.backButton}
                  onPress={() => router.back()}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <Text style={styles.backButtonText}>go back</Text>
                </Pressable>
              </View>
            </View>
          ) : !sessionReady ? (
            <View style={styles.centerOverlay} pointerEvents="none">
              <Text style={styles.loadingText}>Opening…</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {/* top chrome — M5: back · title · search · bookmark · ⋯ (PRD §6.2) */}
      <Animated.View
        style={[styles.chromeTop, { paddingTop: insets.top }, chromeAnimStyle]}
        pointerEvents={chrome ? 'auto' : 'none'}
      >
        <Pressable
          style={styles.iconButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to library"
        >
          <Text style={styles.iconText}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => setSearching(true)}
          accessibilityRole="button"
          accessibilityLabel="Search in this book"
        >
          <Text style={styles.iconTextSmall}>⌕</Text>
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={toggleBookmark}
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? 'Remove bookmark from this page' : 'Bookmark this page'}
        >
          <Text style={[styles.iconTextSmall, bookmarked && { color: theme.accent }]}>
            {bookmarked ? '⚑' : '⚐'}
          </Text>
        </Pressable>
        <Pressable
          style={styles.iconButton}
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Text style={styles.iconText}>⋯</Text>
        </Pressable>
      </Animated.View>

      {/* search replaces the title bar (DESIGN §6.6) */}
      {searching ? (
        <SearchUI
          bookId={book.id}
          onClose={() => setSearching(false)}
          onJumpTo={jumpToSearchMatch}
        />
      ) : null}

      {/* bottom chrome — swaps to the annotate toolbar in annotate mode */}
      <Animated.View
        style={[styles.chromeBottom, { paddingBottom: insets.bottom }, chromeAnimStyle]}
        pointerEvents={chrome ? 'auto' : 'none'}
      >
        {annotateMode ? (
          <AnnotateToolbar
            activeTool={annTool}
            onToolChange={setAnnTool}
            color={annColor}
            onColorChange={setAnnColor}
            opacity={annOpacity}
            onOpacityChange={setAnnOpacity}
            penWidth={penWidth}
            onPenWidthChange={setPenWidth}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={() => void doUndo()}
            onRedo={() => void doRedo()}
          />
        ) : (
          <Scrubber page={page} pageCount={pageCount} onScrubTo={goToPage} />
        )}
      </Animated.View>
      {/* exit-annotate floating button */}
      {annotateMode ? (
        <Pressable
          style={[styles.exitAnnotate, { top: insets.top + 64 }]}
          onPress={() => setAnnotateModeOn(false)}
          accessibilityRole="button"
          accessibilityLabel="Done annotating"
        >
          <Text style={styles.exitAnnotateText}>done</Text>
        </Pressable>
      ) : null}

      {/* page indicator when chrome is hidden (DESIGN §6.2) */}
      {!chrome && sessionReady && !loadError ? (
        <View style={[styles.indicator, { bottom: insets.bottom + spacing.lg }]} pointerEvents="none">
          <Text style={styles.indicatorText}>
            {page} / {pageCount}
          </Text>
        </View>
      ) : null}

      {/* resume chip */}
      {resumeChip ? (
        <Pressable
          style={[styles.chip, { top: insets.top + 64 }]}
          onPress={jumpToPageStart}
          accessibilityRole="button"
          accessibilityLabel={`${resumeChip}. Tap to jump to page start.`}
        >
          <Text style={styles.chipText}>{resumeChip}</Text>
        </Pressable>
      ) : null}

      {/* toast */}
      {toast ? (
        <View style={[styles.toast, { bottom: insets.bottom + 96 }]} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}

      {/* note editor modal */}
      <Modal
        visible={noteAnchor != null}
        animationType="fade"
        transparent
        onRequestClose={() => setNoteAnchor(null)}
      >
        <View style={styles.menuBackdrop}>
          <View style={[styles.noteCard, { marginBottom: insets.bottom + spacing.lg }]}>
            <Text style={styles.noteTitle}>note · p.{page}</Text>
            <TextInput
              style={styles.noteInput}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Write a note…"
              placeholderTextColor={theme.inkMuted}
              multiline
              autoFocus
            />
            <View style={styles.noteRow}>
              <Pressable
                style={styles.noteButton}
                onPress={() => setNoteAnchor(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel note"
              >
                <Text style={styles.noteButtonText}>cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.noteButton, styles.noteButtonPrimary]}
                onPress={saveNote}
                accessibilityRole="button"
                accessibilityLabel="Save note"
              >
                <Text style={[styles.noteButtonText, styles.noteButtonPrimaryText]}>save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* M5: overflow menu (contents, theme, invert, ruler, annotate, stats, keep-awake) */}
      <Modal
        visible={sheet === 'menu'}
        animationType="slide"
        transparent
        onRequestClose={() => setSheet(null)}
      >
        <View style={styles.menuBackdrop}>
          <Pressable
            style={styles.menuBackdropTap}
            onPress={() => setSheet(null)}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
          <View style={[styles.menuSheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <MenuRow
              styles={styles}
              label="contents"
              value="bookmarks · highlights · pages"
              onPress={() => setSheet('contents')}
            />
            <MenuRow
              styles={styles}
              label="reading stats"
              value="streak · weekly · goal"
              onPress={() => setSheet('stats')}
            />
            <MenuRow
              styles={styles}
              label="theme"
              value={themeName}
              onPress={() => void cycleTheme()}
            />
            <MenuRow
              styles={styles}
              label="smart invert"
              value={invertPdf ? 'on' : 'off'}
              onPress={() => void setInvertPdf(!invertPdf)}
            />
            <MenuRow
              styles={styles}
              label="ruler"
              value={ruler.enabled ? 'on' : 'off'}
              onPress={() => {
                ruler.toggle();
                setSheet(null);
              }}
            />
            <MenuRow
              styles={styles}
              label="annotate"
              value={annotateMode ? 'on' : 'off'}
              onPress={() => {
                setAnnotateModeOn(!annotateMode);
                setSheet(null);
              }}
            />
            <MenuRow
              styles={styles}
              label="keep screen awake"
              value={keepAwake ? 'on' : 'off'}
              onPress={() => void setKeepAwake(!keepAwake)}
            />
          </View>
        </View>
      </Modal>

      <ContentsSheet
        bookId={book.id}
        bookTitle={title}
        page={page}
        pageCount={pageCount}
        visible={sheet === 'contents'}
        onClose={() => setSheet(null)}
        onJumpToPage={(p) => {
          setSheet(null);
          goToPage(p);
        }}
        onSelectHighlight={handleSelectHighlight}
        onExport={() => setSheet('export')}
      />

      <ExportSheet
        bookId={book.id}
        bookTitle={title}
        visible={sheet === 'export'}
        onClose={() => setSheet(null)}
      />

      <StatsSheet visible={sheet === 'stats'} onClose={() => setSheet(null)} />
    </View>
  );
}

/** One row of the overflow menu. */
function MenuRow({
  styles,
  label,
  value,
  onPress,
  disabled = false,
}: {
  styles: ReturnType<typeof createStyles>;
  label: string;
  value: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[styles.menuRow, disabled && styles.menuRowDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.menuLabel, disabled && styles.menuLabelDisabled]}>{label}</Text>
      <Text style={[styles.menuValue, disabled && styles.menuLabelDisabled]}>{value}</Text>
    </Pressable>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  pageArea: {
    ...StyleSheet.absoluteFill,
  },
  pageWrap: {
    position: 'absolute',
  },
  centerOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  loadingText: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title2,
    color: theme.inkMuted,
  },
  errorCard: {
    alignItems: 'center',
    gap: spacing.md,
  },
  errorText: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title3,
    color: theme.ink,
    textAlign: 'center',
    lineHeight: typeScale.title3 * 1.4,
  },
  backButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
    borderRadius: 999,
  },
  backButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.ink,
  },
  chromeTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    minHeight: 56,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.rule,
    backgroundColor: theme.bg,
  },
  title: {
    flex: 1,
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title3,
    color: theme.ink,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontFamily: fontFamilies.sans,
    fontSize: 26,
    color: theme.ink,
    lineHeight: 28,
  },
  chromeBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.rule,
    backgroundColor: theme.bg,
  },
  indicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  indicatorText: {
    fontFamily: fontFamilies.mono,
    fontSize: 11,
    letterSpacing: monoLetterSpacing,
    color: theme.ink,
    opacity: 0.4, // DESIGN §6.2: 40%
  },
  chip: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
  },
  chipText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.ink,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
  },
  toastText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.small,
    color: theme.ink,
  },
  rulerEmpty: {
    position: 'absolute',
    alignSelf: 'center',
    top: '42%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
  },
  rulerEmptyText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.small,
    color: theme.inkMuted,
  },
  exitAnnotate: {
    position: 'absolute',
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: theme.accent,
  },
  exitAnnotateText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    fontWeight: '600',
    color: '#0B0B0C',
  },
  noteCard: {
    marginHorizontal: spacing.xl,
    marginTop: 'auto',
    backgroundColor: theme.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
    borderRadius: 4,
    padding: spacing.lg,
  },
  noteTitle: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.inkMuted,
    marginBottom: spacing.sm,
  },
  noteInput: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: theme.ink,
    minHeight: 88,
    textAlignVertical: 'top',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
    borderRadius: 2,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  noteRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  noteButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
  },
  noteButtonText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: theme.inkMuted,
  },
  noteButtonPrimary: {
    backgroundColor: theme.accent,
    marginLeft: spacing.sm,
  },
  noteButtonPrimaryText: {
    color: '#0B0B0C',
    fontWeight: '600',
  },
  iconTextSmall: {
    fontFamily: fontFamilies.sans,
    fontSize: 20,
    color: theme.ink,
    lineHeight: 24,
  },
  flash: {
    position: 'absolute',
    borderWidth: 2,
    opacity: 0.55,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  menuBackdropTap: {
    flex: 1,
  },
  menuSheet: {
    backgroundColor: theme.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.rule,
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.rule,
  },
  menuRowDisabled: {
    opacity: 0.45,
  },
  menuLabel: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: theme.ink,
  },
  menuLabelDisabled: {
    color: theme.inkMuted,
  },
  menuValue: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.accent,
  },
});
}