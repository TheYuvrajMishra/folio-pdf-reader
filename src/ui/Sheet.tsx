/**
 * Sheet — bottom sheet (DESIGN §5): slide-up 260 ms ease-out, 40% scrim.
 * Built on Reanimated directly (no bottom-sheet dep — dependency budget,
 * PRD §7.1). Backdrop tap or swipe-down dismisses.
 */
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { easeOutBezier, motion, radius, sheet, spacing } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { Pressable } from './Pressable';

const ease = Easing.bezier(easeOutBezier[0], easeOutBezier[1], easeOutBezier[2], easeOutBezier[3]);
const SCREEN_H = Dimensions.get('window').height;

interface SheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Accessibility label for the sheet. */
  label?: string;
}

export function Sheet({ visible, onClose, children, label }: SheetProps): React.JSX.Element | null {
  const { colors } = useTheme();
  const translateY = useSharedValue(SCREEN_H);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: sheet.slideUpMs, easing: ease });
      scrim.value = withTiming(sheet.scrimAlpha, { duration: sheet.slideUpMs, easing: ease });
    } else {
      translateY.value = withTiming(SCREEN_H, { duration: motion.fast, easing: ease });
      scrim.value = withTiming(0, { duration: motion.fast, easing: ease });
    }
  }, [visible, translateY, scrim]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        runOnJS(onClose)();
      } else {
        translateY.value = withTiming(0, { duration: motion.fast, easing: ease });
      }
    });

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, scrimStyle]}
      />
      {/* Backdrop tap dismiss */}
      <Pressable
        hapticKind="none"
        noScale
        onPress={onClose}
        style={StyleSheet.absoluteFill}
        accessibilityLabel="Dismiss"
      >
        <View />
      </Pressable>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityLabel={label}
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              maxHeight: SCREEN_H * 0.85,
              backgroundColor: colors.surface,
              borderTopLeftRadius: radius.base,
              borderTopRightRadius: radius.base,
              borderTopWidth: 1,
              borderLeftWidth: 1,
              borderRightWidth: 1,
              borderColor: colors.border,
              padding: spacing.xl,
              // One soft shadow allowed on sheets (DESIGN §3.4).
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -sheet.shadow.offsetY },
              shadowOpacity: sheet.shadow.alpha,
              shadowRadius: sheet.shadow.blur,
              elevation: 8,
            },
            sheetStyle,
          ]}
        >
          <View
            style={{
              alignSelf: 'center',
              width: 40,
              height: 4,
              borderRadius: 2,
              backgroundColor: colors.border,
              marginBottom: spacing.lg,
            }}
          />
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
