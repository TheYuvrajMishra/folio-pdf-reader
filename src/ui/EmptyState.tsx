/**
 * EmptyState / ErrorState (DESIGN §11 matrix).
 * Empty: Title-size statement + calm body + optional primary action.
 * Error: human message + retry/remedy — never raw error strings (PRD §7.9).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AlertCircle, LucideIcon } from 'lucide-react-native';
import { fontFamilyFor, icon, spacing, type } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { Button } from './controls';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, body, actionLabel, onAction }: EmptyStateProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={styles.host} accessible accessibilityLabel={title}>
      <Icon size={40} color={colors.inkMuted} strokeWidth={icon.strokeWidth} />
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      {body ? <Text style={[styles.body, { color: colors.inkMuted }]}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.action}>
          <Button label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

interface ErrorStateProps {
  /** Human message. Never pass a raw exception string (PRD §7.9). */
  message: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, retryLabel = 'Try again', onRetry }: ErrorStateProps): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View style={styles.host} accessible accessibilityLabel={message}>
      <AlertCircle size={40} color={colors.danger} strokeWidth={icon.strokeWidth} />
      <Text style={[styles.title, { color: colors.ink }]}>Something went wrong</Text>
      <Text style={[styles.body, { color: colors.inkMuted }]}>{message}</Text>
      {onRetry ? (
        <View style={styles.action}>
          <Button label={retryLabel} onPress={onRetry} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxxl,
  },
  title: {
    fontSize: type.title.size,
    fontFamily: fontFamilyFor('600'),
    letterSpacing: type.title.size * type.title.letterSpacing,
    lineHeight: type.title.size * type.title.lineHeight,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  body: {
    fontSize: type.body.size,
    fontFamily: fontFamilyFor('400'),
    lineHeight: type.body.size * type.body.lineHeight,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.xl,
  },
});
