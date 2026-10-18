/**
 * Pressable — the ONLY touch primitive in Folio (DESIGN §7, PRD §13).
 * Every pressable in the app uses this: press scale 0.97 (90 ms in /
 * 150 ms out, ease-out) + the right haptic. Raw TouchableOpacity is banned
 * by the ESLint rule in eslint.config.js.
 */
import React, { useCallback } from 'react';
import {
  Pressable as RNPressable,
  PressableProps as RNPressableProps,
  StyleProp,
  ViewStyle,
  AccessibilityRole,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  easeOutBezier,
  motion,
  pressScale,
} from '../theme/tokens';
import { haptic, HapticKind } from '../util/haptics';

const ease = Easing.bezier(easeOutBezier[0], easeOutBezier[1], easeOutBezier[2], easeOutBezier[3]);

export interface PressableProps extends Omit<RNPressableProps, 'style' | 'onPressIn' | 'onPressOut'> {
  style?: StyleProp<ViewStyle>;
  /** Haptic fired on press-in. Default 'light'. Use 'none' for silent presses. */
  hapticKind?: HapticKind;
  /** Disable the scale animation (keeps haptic + opacity of children). Rare. */
  noScale?: boolean;
  children: React.ReactNode;
}

export function Pressable({
  style,
  hapticKind = 'light',
  noScale = false,
  disabled,
  onPress,
  children,
  accessibilityRole = 'button' as AccessibilityRole,
  ...rest
}: PressableProps): React.JSX.Element {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = useCallback(() => {
    haptic(hapticKind);
    if (!noScale) {
      scale.value = withTiming(pressScale, { duration: motion.pressIn, easing: ease });
    }
  }, [hapticKind, noScale, scale]);

  const handlePressOut = useCallback(() => {
    if (!noScale) {
      scale.value = withTiming(1, { duration: motion.pressOut, easing: ease });
    }
  }, [noScale, scale]);

  return (
    <RNPressable
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={style}
      {...rest}
    >
      <Animated.View style={[animatedStyle, disabled && { opacity: 0.4 }]}>
        {children}
      </Animated.View>
    </RNPressable>
  );
}
