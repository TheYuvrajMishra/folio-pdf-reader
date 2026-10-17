/**
 * StatsSheet.tsx — reading stats (M5, PRD §6.11, DESIGN §6.8).
 *
 * Compact bottom sheet: serif big streak number, weekly bars (plain Views
 * with 1 px rules as the grid — the M5-scoped choice over Skia), and a daily
 * goal (pages or minutes) with a thin progress rule. Global stats across all
 * books (book-scoped filtering is a later refinement).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  DEFAULT_GOAL,
  getGoal,
  getStreak,
  getWeeklyMinutes,
  getWeeklyPages,
  setGoal,
  type DailyGoal,
  type DayPages,
  type GoalKind,
} from './sessions';
import { fontFamilies } from '../theme/fonts';
import { monoLetterSpacing, spacing, typeScale, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // getDay(): 0 = Sunday

/** Weekday letter for a local `YYYY-MM-DD` day string. */
function weekdayLetter(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return WEEKDAY_LETTERS[new Date(y, m - 1, d).getDay()];
}

interface StatsSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function StatsSheet({ visible, onClose }: StatsSheetProps) {
  const { colors: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [streak, setStreak] = useState<number | null>(null);
  const [weekly, setWeekly] = useState<DayPages[] | null>(null);
  const [goal, setGoalState] = useState<DailyGoal>(DEFAULT_GOAL);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const reload = useCallback(() => {
    setStreak(null);
    setWeekly(null);
    getGoal()
      .then(async (g) => {
        setGoalState(g);
        const [s, w] = await Promise.all([
          getStreak(),
          g.kind === 'pages' ? getWeeklyPages() : getWeeklyMinutes(),
        ]);
        setStreak(s);
        setWeekly(w);
      })
      .catch(() => {
        setStreak(0);
        setWeekly([]);
      });
  }, []);

  useEffect(() => {
    if (visible) reload();
  }, [visible, reload]);

  const changeKind = useCallback(
    (kind: GoalKind) => {
      const next = { ...goal, kind };
      setGoalState(next);
      setGoal(next).catch(() => undefined);
      reload();
    },
    [goal, reload],
  );

  const bumpGoal = useCallback(
    (delta: number) => {
      const step = goal.kind === 'pages' ? 5 : 10;
      const next = { ...goal, value: Math.max(step, goal.value + delta * step) };
      setGoalState(next);
      setGoal(next).catch(() => undefined);
    },
    [goal],
  );

  const maxBar = Math.max(1, ...(weekly ?? []).map((w) => w.pages));
  const todayValue = weekly && weekly.length > 0 ? weekly[weekly.length - 1].pages : 0;
  const goalRatio = Math.min(1, goal.value > 0 ? todayValue / goal.value : 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}>
          <View style={styles.header}>
            <Text style={styles.title}>reading stats</Text>
            <Pressable
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close stats"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {streak === null || weekly === null ? (
            <ActivityIndicator color={theme.accent} style={styles.loader} />
          ) : (
            <>
              <View style={styles.streakRow}>
                <Text style={styles.streakNumber}>{streak}</Text>
                <Text style={styles.streakLabel}>
                  day streak{streak === 1 ? '' : 's'}
                </Text>
              </View>

              <Text style={styles.sectionLabel}>last 7 days</Text>
              <View style={styles.bars}>
                {weekly.map((w) => (
                  <View key={w.day} style={styles.barCol}>
                    <View style={styles.barTrack}>
                      <View
                        style={[
                          styles.barFill,
                          { height: `${Math.max(2, (w.pages / maxBar) * 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.barDay}>{weekdayLetter(w.day)}</Text>
                    <Text style={styles.barValue}>{w.pages}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.sectionLabel}>daily goal</Text>
              <View style={styles.goalRow}>
                <Pressable
                  style={[styles.kindChip, goal.kind === 'pages' && styles.kindChipActive]}
                  onPress={() => changeKind('pages')}
                  accessibilityRole="button"
                  accessibilityLabel="Goal in pages"
                >
                  <Text
                    style={[styles.kindText, goal.kind === 'pages' && styles.kindTextActive]}
                  >
                    pages
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.kindChip, goal.kind === 'minutes' && styles.kindChipActive]}
                  onPress={() => changeKind('minutes')}
                  accessibilityRole="button"
                  accessibilityLabel="Goal in minutes"
                >
                  <Text
                    style={[styles.kindText, goal.kind === 'minutes' && styles.kindTextActive]}
                  >
                    minutes
                  </Text>
                </Pressable>
                <View style={styles.stepper}>
                  <Pressable
                    style={styles.stepButton}
                    onPress={() => bumpGoal(-1)}
                    accessibilityRole="button"
                    accessibilityLabel="Decrease goal"
                  >
                    <Text style={styles.stepText}>−</Text>
                  </Pressable>
                  <Text style={styles.goalValue}>{goal.value}</Text>
                  <Pressable
                    style={styles.stepButton}
                    onPress={() => bumpGoal(1)}
                    accessibilityRole="button"
                    accessibilityLabel="Increase goal"
                  >
                    <Text style={styles.stepText}>+</Text>
                  </Pressable>
                </View>
              </View>

              <View style={styles.progressRule}>
                <View style={[styles.progressFill, { width: `${goalRatio * 100}%` }]} />
              </View>
              <Text style={styles.progressLabel}>
                {todayValue} / {goal.value} {goal.kind} today
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    backdropTap: {
      flex: 1,
    },
    sheet: {
      backgroundColor: theme.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.rule,
      paddingHorizontal: spacing.gutter,
      paddingTop: spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    title: {
      fontFamily: fontFamilies.serif,
      fontSize: typeScale.title2,
      color: theme.ink,
    },
    closeButton: {
      width: 48,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      fontFamily: fontFamilies.sans,
      fontSize: 16,
      color: theme.inkMuted,
    },
    loader: {
      marginVertical: spacing.xxxl,
    },
    streakRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: spacing.md,
      marginBottom: spacing.xl,
    },
    streakNumber: {
      fontFamily: fontFamilies.serif,
      fontSize: 64,
      lineHeight: 64,
      color: theme.ink,
    },
    streakLabel: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.inkMuted,
    },
    sectionLabel: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
      marginBottom: spacing.sm,
    },
    bars: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: theme.rule,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      marginBottom: spacing.xl,
    },
    barCol: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
    },
    barTrack: {
      height: 72,
      width: 14,
      justifyContent: 'flex-end',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
    },
    barFill: {
      width: 14,
      backgroundColor: theme.accent,
    },
    barDay: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
    },
    barValue: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.ink,
    },
    goalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    kindChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.rule,
      borderRadius: 999,
    },
    kindChipActive: {
      borderColor: theme.accent,
    },
    kindText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.inkMuted,
    },
    kindTextActive: {
      color: theme.accent,
      fontWeight: '600',
    },
    stepper: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: spacing.md,
    },
    stepButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.rule,
      borderRadius: 999,
    },
    stepText: {
      fontFamily: fontFamilies.sans,
      fontSize: 18,
      color: theme.ink,
    },
    goalValue: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.title3,
      letterSpacing: monoLetterSpacing,
      color: theme.ink,
      minWidth: 48,
      textAlign: 'center',
    },
    progressRule: {
      height: 2,
      backgroundColor: theme.rule,
    },
    progressFill: {
      height: 2,
      backgroundColor: theme.accent,
    },
    progressLabel: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
      marginTop: spacing.xs,
    },
  });
}
