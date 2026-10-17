/**
 * AnnotateToolbar.tsx — annotate-mode bottom toolbar (DESIGN §6.4).
 *
 * Layout: tool buttons (highlight · underline · strike · pen · note ·
 * eraser · select), then color dots, then ↶ undo ↷ redo always visible
 * (disabled state when nothing to undo/redo). The active tool gets an
 * ember underline rule. Tool options (pen width 1–12, opacity) live in a
 * compact popover above the toolbar.
 *
 * `useAnnotateGestures` wires Procreate-style gestures in annotate mode
 * only: two-finger tap = undo, three-finger tap = redo. The returned
 * gesture is attached to the annotation overlay via GestureDetector
 * (see ANNOTATE_INTEGRATION.md).
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  type GestureStateChangeEvent,
  type LegacyComposedGesture,
  type TapGestureHandlerEventPayload,
} from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { highlightPalette, themes } from '../theme/tokens';

export type AnnotateTool =
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'pen'
  | 'note'
  | 'eraser'
  | 'select';

const TOOLS: AnnotateTool[] = [
  'highlight',
  'underline',
  'strike',
  'pen',
  'note',
  'eraser',
  'select',
];

const PALETTE_COLORS = Object.values(highlightPalette);

const TOOL_OPTIONS: Partial<Record<AnnotateTool, { width: boolean; opacity: boolean }>> = {
  highlight: { width: false, opacity: true },
  underline: { width: false, opacity: true },
  strike: { width: false, opacity: true },
  pen: { width: true, opacity: true },
};

const t = themes.dark;

/* ---------------- two/three-finger undo-redo ---------------- */

export interface AnnotateGesturesOptions {
  /** Attach only in annotate mode (DESIGN §8). */
  enabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Procreate-style gestures: two-finger tap = undo, three-finger tap =
 * redo. Returns a gesture for <GestureDetector gesture={...}> around the
 * annotation overlay. Haptic tick on fire; annotate mode only.
 */
export function useAnnotateGestures({
  enabled,
  onUndo,
  onRedo,
}: AnnotateGesturesOptions): LegacyComposedGesture {
  // The gesture is rebuilt when the callbacks change so the worklet
  // closure always sees the latest onUndo/onRedo (a ref captured in a
  // worklet would snapshot stale). Parents should useCallback for stability.
  return useMemo(() => {
    const fireUndo = () => {
      onUndo();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    };
    const fireRedo = () => {
      onRedo();
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    };
    type TapEnd = (
      e: GestureStateChangeEvent<TapGestureHandlerEventPayload>,
      success: boolean,
    ) => void;
    const onTwoFingerEnd: TapEnd = (_e, success) => {
      'worklet';
      if (success) runOnJS(fireUndo)();
    };
    const onThreeFingerEnd: TapEnd = (_e, success) => {
      'worklet';
      if (success) runOnJS(fireRedo)();
    };
    const twoFinger = Gesture.Tap()
      .numberOfTaps(1)
      .minPointers(2)
      .onEnd(onTwoFingerEnd)
      .enabled(enabled);
    const threeFinger = Gesture.Tap()
      .numberOfTaps(1)
      .minPointers(3)
      .onEnd(onThreeFingerEnd)
      .enabled(enabled);
    // threeFinger first: a 3-finger tap must not also fire 2-finger undo.
    return Gesture.Exclusive(threeFinger, twoFinger);
  }, [enabled, onUndo, onRedo]);
}

/* ---------------- mini slider (popover) ---------------- */

function MiniSlider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) =>
    setTrackW(e.nativeEvent.layout.width);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((e) => {
          'worklet';
          const w = trackW;
          if (w <= 0) return;
          const frac = Math.max(0, Math.min(1, e.x / w));
          const raw = min + frac * (max - min);
          const snapped = Math.round(raw / step) * step;
          runOnJS(onChange)(Math.max(min, Math.min(max, snapped)));
        }),
    [trackW, min, max, step, onChange],
  );

  const frac = (value - min) / (max - min || 1);
  return (
    <View style={styles.sliderRow} accessible accessibilityLabel={label}>
      <Text style={styles.sliderLabel}>{label}</Text>
      <View style={styles.sliderTrackWrap} onLayout={onLayout}>
        <GestureDetector gesture={pan}>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderFill, { width: `${frac * 100}%` }]} />
            <View style={[styles.sliderThumb, { left: `${frac * 100}%` }]} />
          </View>
        </GestureDetector>
      </View>
      <Text style={styles.sliderValue}>{value}</Text>
    </View>
  );
}

/* ---------------- toolbar ---------------- */

export interface AnnotateToolbarProps {
  activeTool: AnnotateTool;
  onToolChange: (tool: AnnotateTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  /** 0..1 */
  opacity: number;
  onOpacityChange: (v: number) => void;
  /** 1..12 dp */
  penWidth: number;
  onPenWidthChange: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function AnnotateToolbar({
  activeTool,
  onToolChange,
  color,
  onColorChange,
  opacity,
  onOpacityChange,
  penWidth,
  onPenWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: AnnotateToolbarProps) {
  const options = TOOL_OPTIONS[activeTool];
  const pickTool = (tool: AnnotateTool) => {
    onToolChange(tool);
    void Haptics.selectionAsync().catch(() => {});
  };
  const pressUndo = () => {
    if (!canUndo) return;
    onUndo();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };
  const pressRedo = () => {
    if (!canRedo) return;
    onRedo();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  return (
    <View style={styles.root}>
      {options && (
        <View style={styles.popover}>
          {options.width && (
            <MiniSlider
              label="width"
              min={1}
              max={12}
              step={1}
              value={penWidth}
              onChange={onPenWidthChange}
            />
          )}
          {options.opacity && (
            <MiniSlider
              label="opacity"
              min={0.1}
              max={1}
              step={0.05}
              value={Math.round(opacity * 100) / 100}
              onChange={onOpacityChange}
            />
          )}
        </View>
      )}

      <View style={styles.toolsRow}>
        {TOOLS.map((tool) => {
          const active = tool === activeTool;
          return (
            <Pressable
              key={tool}
              onPress={() => pickTool(tool)}
              style={styles.toolButton}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${tool} tool`}
            >
              <Text style={[styles.toolLabel, active && styles.toolLabelActive]}>
                {tool}
              </Text>
              <View style={[styles.toolRule, active && styles.toolRuleActive]} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.hairline} />

      <View style={styles.secondRow}>
        <View style={styles.dotsRow}>
          {PALETTE_COLORS.map((c) => {
            const active = c.toLowerCase() === color.toLowerCase();
            return (
              <Pressable
                key={c}
                onPress={() => onColorChange(c)}
                style={[styles.dot, { backgroundColor: c }]}
                accessibilityRole="button"
                accessibilityLabel={`color ${c}`}
                accessibilityState={{ selected: active }}
              >
                {active && <View style={styles.dotRing} />}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.undoRow}>
          <Pressable
            onPress={pressUndo}
            disabled={!canUndo}
            style={[styles.undoButton, !canUndo && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="undo"
            accessibilityState={{ disabled: !canUndo }}
          >
            <Text style={[styles.undoGlyph, !canUndo && styles.disabledGlyph]}>
              ↶
            </Text>
          </Pressable>
          <Pressable
            onPress={pressRedo}
            disabled={!canRedo}
            style={[styles.undoButton, !canRedo && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel="redo"
            accessibilityState={{ disabled: !canRedo }}
          >
            <Text style={[styles.undoGlyph, !canRedo && styles.disabledGlyph]}>
              ↷
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: t.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.rule,
    paddingBottom: 12,
  },
  popover: {
    position: 'absolute',
    bottom: '100%',
    left: 16,
    right: 16,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  toolsRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  toolButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  toolLabel: {
    color: t.inkMuted,
    fontSize: 11,
  },
  toolLabelActive: {
    color: t.ink,
    fontWeight: '600',
  },
  toolRule: {
    height: 2,
    width: 24,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  toolRuleActive: {
    backgroundColor: t.accent, // ember underline (DESIGN §6.4)
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.rule,
    marginHorizontal: 16,
    marginTop: 2,
  },
  secondRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: t.accent,
  },
  undoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  undoButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoGlyph: {
    color: t.ink,
    fontSize: 24,
  },
  disabled: {
    opacity: 0.3,
  },
  disabledGlyph: {
    color: t.inkMuted,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  sliderLabel: {
    color: t.inkMuted,
    fontSize: 11,
    width: 52,
  },
  sliderTrackWrap: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  sliderTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: t.rule,
    justifyContent: 'center',
  },
  sliderFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: t.accent,
  },
  sliderThumb: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: t.ink,
    marginLeft: -8,
    top: -6,
  },
  sliderValue: {
    color: t.inkMuted,
    fontSize: 11,
    width: 36,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
