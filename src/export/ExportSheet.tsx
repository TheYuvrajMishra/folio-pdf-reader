/**
 * ExportSheet.tsx — highlight export (M5, PRD §6.10).
 *
 * Bottom sheet with the two formats: Markdown and JSON. Each row shares via
 * the system share sheet (expo-sharing); the share sheet is also the
 * copy path (no expo-clipboard dependency — see the M5 report).
 */

import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { shareExport, type ExportFormat } from './export';
import { fontFamilies } from '../theme/fonts';
import { spacing, typeScale, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

interface ExportSheetProps {
  bookId: string;
  bookTitle: string;
  visible: boolean;
  onClose: () => void;
}

const ROWS: Array<{ format: ExportFormat; title: string; blurb: string }> = [
  {
    format: 'md',
    title: 'Markdown',
    blurb: 'Grouped by page, with color tags and notes — pastes into any notes app.',
  },
  {
    format: 'json',
    title: 'JSON',
    blurb: 'Machine-readable: page, type, color, excerpt, note, rects.',
  },
];

export function ExportSheet({ bookId, bookTitle, visible, onClose }: ExportSheetProps) {
  const { colors: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const onShare = async (format: ExportFormat) => {
    setBusy(format);
    setError(null);
    try {
      await shareExport(bookId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>export highlights</Text>
            <Pressable
              style={styles.closeButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close export"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          <Text style={styles.bookTitle} numberOfLines={1}>
            {bookTitle}
          </Text>

          {ROWS.map((r) => (
            <View key={r.format} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{r.title}</Text>
                <Text style={styles.rowBlurb}>{r.blurb}</Text>
              </View>
              <Pressable
                style={styles.shareButton}
                onPress={() => onShare(r.format)}
                disabled={busy !== null}
                accessibilityRole="button"
                accessibilityLabel={`Share as ${r.title}`}
              >
                {busy === r.format ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : (
                  <Text style={styles.shareText}>share</Text>
                )}
              </Pressable>
            </View>
          ))}

          {error ? <Text style={styles.error}>{error}</Text> : null}
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
    bookTitle: {
      fontFamily: fontFamilies.mono,
      fontSize: 11,
      letterSpacing: 0.4,
      color: theme.inkMuted,
      marginTop: spacing.xs,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.rule,
      gap: spacing.md,
    },
    rowText: {
      flex: 1,
    },
    rowTitle: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.ink,
      fontWeight: '600',
    },
    rowBlurb: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.inkMuted,
      lineHeight: typeScale.small * 1.4,
      marginTop: 2,
    },
    shareButton: {
      minWidth: 88,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.accent,
      borderRadius: 999,
      paddingHorizontal: spacing.lg,
    },
    shareText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.accent,
      fontWeight: '600',
    },
    error: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.danger,
      marginTop: spacing.md,
    },
  });
}
