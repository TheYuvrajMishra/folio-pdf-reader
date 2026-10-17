/**
 * RulerOverlay.tsx — the reading-ruler band (PRD §6.5, DESIGN §6.3 / §7).
 *
 * P0 style = band: amber #FFB020 @ 22% fill + 1 px top/bottom rules @ 60%
 * (tokens.rulerTokens). The band glides between lines on a reanimated
 * spring {damping: 22, stiffness: 320} (~120 ms, DESIGN §7); set glide=false
 * to snap instead (or when reduced motion is on).
 *
 * Spotlight and underline are P1 styles (PRD §6.5); they are scaffolded here
 * behind the `style` prop so the reader can offer them later without
 * restructuring. pointerEvents="none" — the band never eats touches.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { rulerTokens } from '../theme/tokens';

/** P0 = band; spotlight/underline are P1 (PRD §6.5). */
export type RulerOverlayStyle = 'band' | 'spotlight' | 'underline';

/** Screen-space rect, e.g. from the reader's toScreen(). */
export interface RulerScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RulerOverlayProps {
  /** Null (or visible=false) hides the band. */
  box: RulerScreenBox | null;
  visible?: boolean;
  style?: RulerOverlayStyle;
  color?: string;
  fillAlpha?: number;
  ruleAlpha?: number;
  glide?: boolean;
  /** Spotlight only: screen size, to dim around the band. Falls back to band. */
  screen?: { width: number; height: number };
  /** Bump when the page changes: band fades in over 140 ms (DESIGN §7). */
  pageKey?: string | number;
}

const SPRING = { damping: 22, stiffness: 320 };
const FADE_MS = 140;

/** #RRGGBB + alpha → #RRGGBBAA. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export function RulerOverlay({
  box,
  visible = true,
  style = 'band',
  color = rulerTokens.bandFill,
  fillAlpha = rulerTokens.bandFillAlpha,
  ruleAlpha = rulerTokens.bandRuleAlpha,
  glide = true,
  screen,
  pageKey,
}: RulerOverlayProps) {
  const sx = useSharedValue(box?.x ?? 0);
  const sy = useSharedValue(box?.y ?? 0);
  const sw = useSharedValue(box?.width ?? 0);
  const sh = useSharedValue(box?.height ?? 0);
  const op = useSharedValue(box && visible ? 1 : 0);
  const firstRender = useRef(true);

  const key = box
    ? `${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}`
    : 'none';

  // Move / show / hide.
  useEffect(() => {
    if (!box || !visible) {
      op.value = withTiming(0, { duration: 120 });
      return;
    }
    if (glide && !firstRender.current) {
      sx.value = withSpring(box.x, SPRING);
      sy.value = withSpring(box.y, SPRING);
      sw.value = withSpring(box.width, SPRING);
      sh.value = withSpring(box.height, SPRING);
    } else {
      sx.value = box.x;
      sy.value = box.y;
      sw.value = box.width;
      sh.value = box.height;
    }
    op.value = withTiming(1, { duration: 120 });
    firstRender.current = false;
    // `key` intentionally aggregates the box fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, glide, visible]);

  // Cross-page: fade the band in over 140 ms after the turn (DESIGN §7).
  useEffect(() => {
    if (firstRender.current) return;
    if (box && visible) {
      op.value = 0;
      op.value = withTiming(1, { duration: FADE_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  const bandAnim = useAnimatedStyle(() => ({
    left: sx.value,
    top: sy.value,
    width: sw.value,
    height: sh.value,
    opacity: op.value,
  }));

  const dimAnim = useAnimatedStyle(() => ({ opacity: op.value }));

  if (style === 'spotlight' && screen && box) {
    // P1: dim everything except the band (bg @ 75% per tokens). Dim rects
    // follow the latest box (non-animated); the band itself still glides.
    const dim = withAlpha('#000000', rulerTokens.spotlightDimAlpha);
    const dims: Array<{ left: number; top: number; width: number; height: number }> = [
      { left: 0, top: 0, width: screen.width, height: Math.max(0, box.y) },
      { left: 0, top: box.y + box.height, width: screen.width, height: Math.max(0, screen.height - box.y - box.height) },
      { left: 0, top: box.y, width: Math.max(0, box.x), height: box.height },
      { left: box.x + box.width, top: box.y, width: Math.max(0, screen.width - box.x - box.width), height: box.height },
    ];
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {dims.map((d, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[styles.dim, dimAnim, d, { backgroundColor: dim }]}
          />
        ))}
        <Animated.View pointerEvents="none" style={[styles.band, bandAnim]} />
      </View>
    );
  }

  if (style === 'underline') {
    // P1: thin accent rule at the band's bottom edge instead of a fill.
    return (
      <Animated.View pointerEvents="none" style={[styles.band, bandAnim]}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            backgroundColor: withAlpha(color, Math.max(ruleAlpha, 0.8)),
          }}
        />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.band,
        bandAnim,
        {
          backgroundColor: withAlpha(color, fillAlpha),
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderTopColor: withAlpha(color, ruleAlpha),
          borderBottomColor: withAlpha(color, ruleAlpha),
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
  },
  dim: {
    position: 'absolute',
  },
});
