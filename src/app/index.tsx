/**
 * Folio library screen (M0 hello-world). DESIGN.md §6.1.
 * Empty shelf only — import lands in M1. The button and FAB say so instead
 * of faking it.
 */

import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fontFamilies } from '../theme/fonts';
import { lineHeight, monoLetterSpacing, radii, spacing, themes, typeScale } from '../theme/tokens';

const t = themes.dark;

function comingSoon() {
  Alert.alert('Coming in M1', 'PDF import lands in M1. This build is the M0 boot + theme + fonts proof.');
}

export default function LibraryScreen() {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Notebook margin rule — DESIGN.md §5. */}
      <View style={styles.marginRule} pointerEvents="none" />

      <View style={styles.header}>
        <Text style={styles.brand} accessibilityRole="header">
          FOLIO
        </Text>
      </View>
      <View style={styles.headerRule} />

      <View style={styles.empty} accessibilityRole="text" accessibilityLabel="Nothing on the shelf.">
        <Text style={styles.emptySerif}>Nothing on the shelf.</Text>
        <Pressable
          style={styles.importButton}
          onPress={comingSoon}
          accessibilityRole="button"
          accessibilityLabel="Import a PDF"
          accessibilityHint="PDF import arrives in milestone M1">
          <Text style={styles.importButtonText}>Import a PDF</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.fab}
        onPress={comingSoon}
        accessibilityRole="button"
        accessibilityLabel="Import a PDF"
        accessibilityHint="PDF import arrives in milestone M1">
        <Text style={styles.fabText}>(+)</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: t.bg,
  },
  marginRule: {
    position: 'absolute',
    left: spacing.gutter,
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: t.rule,
  },
  header: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: {
    fontFamily: fontFamilies.sans,
    fontWeight: '600',
    fontSize: typeScale.title3,
    letterSpacing: 4,
    color: t.ink,
  },
  headerRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.rule,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.gutter,
    gap: spacing.xl,
  },
  emptySerif: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title1,
    lineHeight: typeScale.title1 * lineHeight.title,
    color: t.ink,
    textAlign: 'center',
  },
  importButton: {
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  importButtonText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: t.accent,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: radii.floating,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.rule,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.body,
    letterSpacing: monoLetterSpacing,
    color: t.ink,
  },
});
