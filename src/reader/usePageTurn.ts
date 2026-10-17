/**
 * usePageTurn.ts — gesture + animation state machine for page turns (M2).
 *
 * Owns the 0..1 `progress` shared value that `PageTurnView` renders:
 * - Finger drag: progress follows 1:1 via `curlProgressFromDrag`; the drag
 *   direction sets `direction` (drag left = forward/next page).
 * - Release: commit when progress > 35% OR fling > 800 px/s in the turn
 *   direction (PRD §6.3), else cancel.
 * - Settle drive depends on style (`turnDriveForStyle`): curl settles with the
 *   { damping: 20, stiffness: 180, mass: 1 } spring; slide/fade use linear
 *   timing (easing lives inside `slideFrameAt`); 'none' is instant;
 *   reduced motion forces the 120 ms fade.
 * - Tap-zone / programmatic turns: `runAnimatedTurn(dir)` animates 0 → 1.
 *
 * Auto-downgrade (PRD §6.3): a UI-thread frame callback samples per-frame
 * times while `turning`; at settle the turn's p95 is pushed onto a rolling
 * 3-turn window and `shouldDowngrade` is evaluated. On fire (style === 'curl'):
 * settings are persisted (`page_animation` → 'slide', `animation_downgraded`
 * → true), `downgraded` flips, and `onDowngrade` fires on the JS thread so the
 * caller can toast. Each frame time is also reported to `recordFrameTime`.
 *
 * Out-of-bounds turns (e.g. forward on the last page) are the caller's call:
 * `onCommit` receives the direction; if the target page doesn't exist the
 * caller should `cancelTurn()` instead of advancing.
 */

import { useEffect, useMemo } from 'react';
import { Gesture, type GestureType } from 'react-native-gesture-handler';
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { curlProgressFromDrag } from '../render/curl';
import {
  decideTurnEnd,
  p95,
  shouldDowngrade,
  turnDriveForStyle,
} from '../render/turnPolicy';
import { SETTINGS_KEYS, setSetting, type PageAnimationStyle } from '../data/settings';

/** Horizontal movement (px) before the drag counts as a page turn. */
const DRAG_ACTIVATE_PX = 12;
/** Minimum drag (px) before the turn direction is latched. */
const DIRECTION_LATCH_PX = 4;

export interface PageTurnApi {
  /** Turn progress 0..1 (drives PageTurnView). */
  progress: SharedValue<number>;
  /** True from drag-start / runAnimatedTurn until the settle finishes. */
  turning: SharedValue<boolean>;
  /** 1 = forward (next page), -1 = backward. Latched from drag direction. */
  direction: SharedValue<1 | -1>;
  /** Flips true the first time the auto-downgrade fires (curl → slide). */
  downgraded: SharedValue<boolean>;
  /** Horizontal drag gesture; the coordinator composes it with pinch/tap. */
  gesture: GestureType;
  /** Animate progress → 1, then onCommit(direction). */
  commitTurn(): void;
  /** Animate progress → 0, then onCancel(). */
  cancelTurn(): void;
  /** Programmatic turn (tap zones, ruler cross-page): 0 → 1 in `dir`. */
  runAnimatedTurn(dir: 1 | -1): void;
}

export interface UsePageTurnOpts {
  pageWidth: number;
  style: PageAnimationStyle;
  reducedMotion: boolean;
  /** UI-thread gate: the drag gesture does nothing while false (zoomed / annotate mode). */
  enabled: SharedValue<boolean>;
  /** Caller advances the page index when progress hits 1. */
  onCommit(dir: 1 | -1): void;
  onCancel(): void;
  /** Telemetry tap: every UI-thread frame time (ms) sampled during a turn. */
  recordFrameTime(ms: number): void;
  /** JS-thread notification after an auto-downgrade (caller toasts). */
  onDowngrade?(): void;
  /** JS-thread notification when a drag latches its direction (caller preloads the back-page raster). */
  onDirectionLatch?(dir: 1 | -1): void;
}

interface TurnCallbacks {
  onCommit(dir: 1 | -1): void;
  onCancel(): void;
  recordFrameTime(ms: number): void;
  onDowngrade?(): void;
  onDirectionLatch?(dir: 1 | -1): void;
}

export function usePageTurn(opts: UsePageTurnOpts): PageTurnApi {
  const { pageWidth, style, reducedMotion } = opts;

  const progress = useSharedValue(0);
  const turning = useSharedValue(false);
  const direction = useSharedValue<1 | -1>(1);
  const downgraded = useSharedValue(false);

  // UI-thread mirrors of props (the gesture is created once; it must never
  // close over stale render-scope values).
  const widthSV = useSharedValue(pageWidth);
  const styleSV = useSharedValue<PageAnimationStyle>(style);
  const reducedMotionSV = useSharedValue(reducedMotion);
  useEffect(() => {
    widthSV.value = pageWidth;
  }, [pageWidth, widthSV]);
  useEffect(() => {
    styleSV.value = style;
  }, [style, styleSV]);
  useEffect(() => {
    reducedMotionSV.value = reducedMotion;
  }, [reducedMotion, reducedMotionSV]);

  // Callbacks behind a shared value so UI-thread worklets always invoke the
  // latest render's callbacks (a plain ref would be a stale closure).
  const cbsSV = useSharedValue<TurnCallbacks>({
    onCommit: opts.onCommit,
    onCancel: opts.onCancel,
    recordFrameTime: opts.recordFrameTime,
    onDowngrade: opts.onDowngrade,
    onDirectionLatch: opts.onDirectionLatch,
  });
  useEffect(() => {
    cbsSV.value = {
      onCommit: opts.onCommit,
      onCancel: opts.onCancel,
      recordFrameTime: opts.recordFrameTime,
      onDowngrade: opts.onDowngrade,
      onDirectionLatch: opts.onDirectionLatch,
    };
  }, [opts.onCommit, opts.onCancel, opts.recordFrameTime, opts.onDowngrade, opts.onDirectionLatch, cbsSV]);

  // --- auto-downgrade sampling -------------------------------------------
  const frameSamplesSV = useSharedValue<number[]>([]);
  const recentP95sSV = useSharedValue<number[]>([]);
  const downgradeLatchSV = useSharedValue(false);

  const applyDowngrade = () => {
    downgraded.value = true;
    void (async () => {
      try {
        await setSetting(SETTINGS_KEYS.PAGE_ANIMATION, 'slide' as PageAnimationStyle);
        await setSetting(SETTINGS_KEYS.ANIMATION_DOWNGRADED, true);
      } catch {
        // Non-fatal: the toast still informs the user.
      }
      try {
        cbsSV.value.onDowngrade?.();
      } catch {
        // Never let a toast handler break the reader.
      }
    })();
  };

  const finishTurn = (completed: boolean) => {
    'worklet';
    const samples = frameSamplesSV.value;
    frameSamplesSV.value = [];
    turning.value = false;
    if (samples.length >= 2 && styleSV.value === 'curl' && !downgradeLatchSV.value) {
      const next = [...recentP95sSV.value, p95(samples)].slice(-3);
      recentP95sSV.value = next;
      if (shouldDowngrade(next)) {
        downgradeLatchSV.value = true;
        runOnJS(applyDowngrade)();
      }
    }
    if (completed) {
      const dir = direction.value;
      runOnJS(() => cbsSV.value.onCommit(dir))();
    } else {
      runOnJS(() => cbsSV.value.onCancel())();
    }
  };

  const settleTo = (target: 0 | 1, completed: boolean) => {
    'worklet';
    const drive = turnDriveForStyle(styleSV.value, reducedMotionSV.value);
    const onDone = (finished?: boolean) => {
      'worklet';
      // Interrupted animations (finished === false) are superseded by the
      // newer animation; only settled ones notify.
      if (finished) {
        finishTurn(completed);
      }
    };
    if (drive.kind === 'instant') {
      progress.value = target;
      finishTurn(completed);
    } else if (drive.kind === 'spring') {
      progress.value = withSpring(
        target,
        { damping: drive.damping, stiffness: drive.stiffness, mass: drive.mass },
        onDone,
      );
    } else {
      progress.value = withTiming(target, { duration: drive.durationMs }, onDone);
    }
  };

  const commitTurn = () => {
    'worklet';
    settleTo(1, true);
  };

  const cancelTurn = () => {
    'worklet';
    settleTo(0, false);
  };

  const runAnimatedTurn = (dir: 1 | -1) => {
    'worklet';
    direction.value = dir;
    progress.value = 0;
    turning.value = true;
    settleTo(1, true);
  };

  // Sample UI-thread frame times for the whole interaction (drag + settle).
  useFrameCallback((frameInfo) => {
    'worklet';
    if (!turning.value) {
      return;
    }
    const dt = frameInfo.timeSincePreviousFrame;
    if (dt == null) {
      return;
    }
    frameSamplesSV.value.push(dt);
    const ms = dt;
    runOnJS(() => cbsSV.value.recordFrameTime(ms))();
  });

  const dirKnownSV = useSharedValue(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-DRAG_ACTIVATE_PX, DRAG_ACTIVATE_PX])
        .failOffsetY([-DRAG_ACTIVATE_PX, DRAG_ACTIVATE_PX])
        .onStart(() => {
          'worklet';
          if (!opts.enabled.value) {
            return;
          }
          turning.value = true;
          dirKnownSV.value = false;
        })
        .onUpdate((e) => {
          'worklet';
          if (!turning.value) {
            return;
          }
          const dx = e.translationX;
          if (!dirKnownSV.value) {
            if (Math.abs(dx) <= DIRECTION_LATCH_PX) {
              return;
            }
            direction.value = dx < 0 ? 1 : -1;
            dirKnownSV.value = true;
            const latched = direction.value;
            runOnJS(() => cbsSV.value.onDirectionLatch?.(latched))();
          }
          progress.value = curlProgressFromDrag(
            dx,
            widthSV.value,
            direction.value === 1 ? 'forward' : 'backward',
          );
        })
        .onEnd((e) => {
          'worklet';
          if (!turning.value) {
            return;
          }
          if (!dirKnownSV.value) {
            // Activated but never moved horizontally: not a turn.
            turning.value = false;
            progress.value = 0;
            return;
          }
          const dir = direction.value;
          const velocityInDir = dir === 1 ? -e.velocityX : e.velocityX;
          if (decideTurnEnd(progress.value, velocityInDir) === 'commit') {
            commitTurn();
          } else {
            cancelTurn();
          }
        })
        .onFinalize((_e, success) => {
          'worklet';
          if (!success && turning.value) {
            // Interrupted (OS took over): snap back silently.
            progress.value = 0;
            turning.value = false;
            frameSamplesSV.value = [];
          }
        }),
    // Created once: the worklets only touch SharedValues and closure-captured
    // pure functions, so the first-render instances never go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    progress,
    turning,
    direction,
    downgraded,
    gesture,
    commitTurn,
    cancelTurn,
    runAnimatedTurn,
  };
}
