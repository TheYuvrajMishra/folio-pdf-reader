/**
 * Library (M0): hello-world shell. Shows the designed empty state
 * (DESIGN §11) until M1 wires the import pipeline. Exercises EmptyState,
 * theme, and the Pressable primitive end to end.
 */
import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { BookOpen } from 'lucide-react-native';
import { useTheme } from '../src/theme/ThemeContext';
import { EmptyState } from '../src/ui/EmptyState';
import { fontFamilyFor, gutter, spacing, type } from '../src/theme/tokens';

export default function LibraryScreen(): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.host, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.wordmark, { color: colors.ink }]}>folio</Text>
      </View>
      <EmptyState
        icon={BookOpen}
        title="Nothing on the shelf yet."
        body="Import a PDF to start reading."
        actionLabel="Import a PDF"
        onAction={() => {
          // M1: opens the document picker import pipeline.
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  header: {
    paddingHorizontal: gutter.screen,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  wordmark: {
    fontSize: type.title.size,
    fontFamily: fontFamilyFor('600'),
    letterSpacing: type.title.size * type.title.letterSpacing,
  },
});
