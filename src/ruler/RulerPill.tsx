/**
 * RulerPill.tsx — floating ruler controls (PRD §6.5, DESIGN §6.3).
 *
 * Vertical pill on the right edge (drag the grip to swap sides): ▲ / ▼
 * 56 dp buttons, a mono line counter between them, and a drag grip.
 * Long-press ▲/▼ repeats at 6 steps/s. The pill fades to 35% opacity after
 * 2 s idle; any touch restores it. TalkBack: buttons announce the current
 * line ("line 7 of 32", DESIGN §12).
 */

import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { fontFamilies } from '../theme/fonts';
import { monoLetterSpacing, radii, themes, typeScale } from '../theme/tokens';

export interface RulerPillProps {
  visible: boolean;
  /** 0-based current line; null when hidden/pixel mode (counter shows ––). */
  lineIndex: number | null;
  totalLines: number;
  onStep(dir: 1 | -1): void;
  side: 'left' | 'right';
  onSideChange(side: 'left' | 'right'): void;
  accent?: string;
}

/** Long-press repeat rate: 6 steps/s (PRD §6.5). */
const REPEAT_MS = 1000 / 6;
/** Hold delay before repeat kicks in. */
const REPEAT_DELAY_MS = 450;
/** Idle fade: 2 s → 35% opacity (DESIGN §6.3). */
const IDLE_MS = 2000;
const IDLE_OPACITY = 0.35;
/** Horizontal drag past this swaps the pill side. */
const SIDE_SWAP_PX = 48;

const chrome = themes.dark;

export function RulerPill({
  visible,
  lineIndex,
  totalLines,
  onStep,
  side,
  onSideChange,
  accent = chrome.accent,
}: RulerPillProps) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const baseY = useSharedValue(0);
  const idleOp = useSharedValue(1);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPressTimers = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  };

  /** Any touch restores full opacity and restarts the 2 s idle clock. */
  const poke = () => {
    idleOp.value = withTiming(1, { duration: 150 });
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleOp.value = withTiming(IDLE_OPACITY, { duration: 300 });
    }, IDLE_MS);
  };

  useEffect(() => {
    poke();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      clearPressTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginStep = (dir: 1 | -1) => {
    poke();
    onStep(dir);
    pressTimer.current = setTimeout(() => {
      repeatTimer.current = setInterval(() => onStep(dir), REPEAT_MS);
    }, REPEAT_DELAY_MS);
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      'worklet';
      runOnJS(poke)();
    })
    .onUpdate((e) => {
      'worklet';
      dragX.value = e.translationX;
      dragY.value = baseY.value + e.translationY;
    })
    .onEnd((e) => {
      'worklet';
      if (Math.abs(e.translationX) > SIDE_SWAP_PX) {
        runOnJS(onSideChange)(e.translationX > 0 ? 'right' : 'left');
      }
      baseY.value = dragY.value;
      dragX.value = 0;
    });

  const pillAnim = useAnimatedStyle(() => ({
    opacity: idleOp.value,
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  if (!visible) return null;

  const n = lineIndex === null ? null : lineIndex + 1;
  const counter = n === null ? '––' : String(n).padStart(2, '0');
  const talkback =
    n === null
      ? 'ruler'
      : `line ${n} of ${totalLines}`;

  const stepButton = (dir: 1 | -1, glyph: string, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} — ${talkback}`}
      onPressIn={() => beginStep(dir)}
      onPressOut={clearPressTimers}
      style={({ pressed }) => [styles.step, pressed && styles.stepPressed]}
    >
      <Text style={[styles.glyph, { color: accent }]}>{glyph}</Text>
    </Pressable>
  );

  return (
    <Animated.View
      style={[
        styles.pill,
        side === 'left' ? styles.left : styles.right,
        pillAnim,
      ]}
      pointerEvents="box-none"
    >
      {stepButton(-1, '▲', 'previous line')}
      <Text
        style={styles.counter}
        accessibilityRole="text"
        accessibilityLabel={talkback}
      >
        {counter}
      </Text>
      {stepButton(1, '▼', 'next line')}
      <GestureDetector gesture={pan}>
        <View style={styles.grip} accessibilityRole="button" accessibilityLabel="drag to move ruler controls">
          <View style={styles.gripBar} />
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: '38%',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: radii.floating,
    backgroundColor: 'rgba(20, 20, 22, 0.92)',
    // 56 dp buttons + counter + grip, per DESIGN §6.3.
  },
  left: { left: 12 },
  right: { right: 12 },
  step: {
    width: 56,
    height: 56,
    borderRadius: radii.floating,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  glyph: {
    fontSize: 22,
    lineHeight: 24,
  },
  counter: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: chrome.ink,
    paddingVertical: 6,
  },
  grip: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  gripBar: {
    width: 28,
    height: 4,
    borderRadius: radii.floating,
    backgroundColor: chrome.inkMuted,
  },
});
