/**
 * Toast — one-line transient confirmation (DESIGN §9: "Saved", "Goal hit").
 * Small, once, skippable. Distinct from Snackbar: no action, shorter life.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { easeOutBezier, fontFamilyFor, motion, radius, spacing, type } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';

const ease = Easing.bezier(easeOutBezier[0], easeOutBezier[1], easeOutBezier[2], easeOutBezier[3]);

const ToastContext = createContext<{ toast: (message: string) => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { colors } = useTheme();
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opacity = useSharedValue(0);

  const toast = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(msg);
    opacity.value = withTiming(1, { duration: motion.fast, easing: ease });
    timer.current = setTimeout(() => {
      opacity.value = withTiming(0, { duration: motion.base, easing: ease });
      setTimeout(() => setMessage(null), motion.base);
    }, 2500);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {message && (
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            styles.host,
            animatedStyle,
            { backgroundColor: colors.ink, },
          ]}
        >
          <Text style={[styles.text, { color: colors.bg }]}>{message}</Text>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: spacing.xxxl + spacing.xxl,
    borderRadius: radius.round,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    elevation: 6,
  },
  text: {
    fontSize: type.body.size,
    fontFamily: fontFamilyFor('500'),
  },
});
