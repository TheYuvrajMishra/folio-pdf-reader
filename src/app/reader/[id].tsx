/**
 * reader/[id].tsx — the /reader/:id route.
 *
 * Loads the book via the library agent's books repository and hands it to
 * ReaderScreen. `key={book.id}` gives each book a fresh reader (session,
 * resume controller, gestures) even when expo-router reuses the route.
 */

import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getBook } from '../../data/books';
import { ReaderScreen, type ReaderBook } from '../../reader/ReaderScreen';
import { fontFamilies } from '../../theme/fonts';
import { defaultTheme, monoLetterSpacing, spacing, themes, typeScale } from '../../theme/tokens';

const theme = themes[defaultTheme];

export default function ReaderRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBook(null);
    setError(null);
    if (!id) {
      setError('No book id in the route.');
      return;
    }
    getBook(id)
      .then((b) => {
        if (cancelled) return;
        if (!b) {
          setError('Book not found in the library.');
          return;
        }
        setBook({ id: b.id, title: b.title, file_path: b.filePath });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the book.');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable
          style={styles.backButton}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonText}>go back</Text>
        </Pressable>
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.center}>
        <Text style={styles.loading}>Opening…</Text>
      </View>
    );
  }

  return <ReaderScreen key={book.id} book={book} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    gap: spacing.md,
  },
  loading: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title2,
    color: theme.inkMuted,
  },
  error: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title3,
    color: theme.ink,
    textAlign: 'center',
    lineHeight: typeScale.title3 * 1.4,
  },
  backButton: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.rule,
    borderRadius: 999,
  },
  backButtonText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.ink,
  },
});
