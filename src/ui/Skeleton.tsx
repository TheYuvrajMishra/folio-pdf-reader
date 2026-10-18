/**
 * Skeleton — the ONLY loading placeholder in Folio (DESIGN §5, PRD §13).
 * Zero spinners anywhere. A calm opacity pulse on a surface block.
 * Honors reduced motion (static block).
 */
import React, { useEffect } from 'react';
import { AccessibilityInfo, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { motion, radius } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = radius.base,
  style,
}: SkeletonProps): React.JSX.Element {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.55);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      opacity.value = withRepeat(
        withTiming(1, { duration: motion.slow * 2, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityLabel="Loading"
      accessible
      style={[
        {
          width,
          height,
          borderRadius,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

/** Skeleton card for the library grid (DESIGN §11). */
export function SkeletonCard(): React.JSX.Element {
  return (
    <Animated.View>
      <Skeleton height={180} />
      <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
      <Skeleton height={12} width="45%" style={{ marginTop: 4 }} />
    </Animated.View>
  );
}

/** Skeleton rows for sheets / lists (DESIGN §11). */
export function SkeletonRows({ count = 4 }: { count?: number }): React.JSX.Element {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={44} style={{ marginBottom: 8 }} />
      ))}
    </>
  );
}
