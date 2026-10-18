/**
 * Snackbar — reversible-by-default feedback (DESIGN §1.5, §9).
 * "Highlight removed · Undo" — destructive actions get Undo, not dialogs.
 * One snackbar at a time; auto-dismiss 4 s; slide + fade 220 ms.
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
import { Pressable } from './Pressable';

const ease = Easing.bezier(easeOutBezier[0], easeOutBezier[1], easeOutBezier[2], easeOutBezier[3]);
const DURATION_MS = 4000;

export interface SnackbarOptions {
  message: string;
  /** Label for the action button, e.g. "Undo". */
  actionLabel?: string;
  onAction?: () => void;
}

interface SnackbarContextValue {
  show: (opts: SnackbarOptions) => void;
}

const SnackbarContext = createContext<SnackbarContextValue>({ show: () => {} });
export const useSnackbar = (): SnackbarContextValue => useContext(SnackbarContext);

export function SnackbarProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { colors } = useTheme();
  const [current, setCurrent] = useState<SnackbarOptions | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateY = useSharedValue(24);
  const opacity = useSharedValue(0);

  const show = useCallback((opts: SnackbarOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(opts);
    translateY.value = withTiming(0, { duration: motion.base, easing: ease });
    opacity.value = withTiming(1, { duration: motion.base, easing: ease });
    timer.current = setTimeout(() => {
      translateY.value = withTiming(24, { duration: motion.fast, easing: ease });
      opacity.value = withTiming(0, { duration: motion.fast, easing: ease });
      setTimeout(() => setCurrent(null), motion.fast);
    }, DURATION_MS);
  }, [translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <SnackbarContext.Provider value={{ show }}>
      {children}
      {current && (
        <Animated.View
          accessibilityLiveRegion="polite"
          style={[
            styles.host,
            animatedStyle,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            numberOfLines={2}
            style={[styles.message, { color: colors.ink }]}
          >
            {current.message}
          </Text>
          {current.actionLabel && (
            <Pressable
              onPress={() => {
                current.onAction?.();
                if (timer.current) clearTimeout(timer.current);
                setCurrent(null);
              }}
              accessibilityLabel={current.actionLabel}
              style={styles.action}
            >
              <Text style={[styles.actionText, { color: colors.accent }]}>
                {current.actionLabel}
              </Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </SnackbarContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xxxl,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.base,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    elevation: 6,
  },
  message: {
    flex: 1,
    fontSize: type.body.size,
    fontFamily: fontFamilyFor('400'),
    lineHeight: type.body.size * type.body.lineHeight,
  },
  action: {
    marginLeft: spacing.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  actionText: {
    fontSize: type.body.size,
    fontFamily: fontFamilyFor('600'),
  },
});
