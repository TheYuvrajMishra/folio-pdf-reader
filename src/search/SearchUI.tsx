/**
 * SearchUI.tsx — in-reader search (M5, DESIGN §6.6).
 *
 * Replaces the title bar when active: a top input row (query, prev/next
 * match arrows, close) plus a results list below — rows with a mono page
 * number and the snippet with matches in ember. Tap a row (or the arrows)
 * to jump; the parent flashes the matched line on the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  parseSnippet,
  searchBook,
  type SearchResult,
  type SnippetSegment,
} from './search';
import { fontFamilies } from '../theme/fonts';
import { monoLetterSpacing, spacing, typeScale, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

const DEBOUNCE_MS = 250;

interface SearchUIProps {
  bookId: string;
  onClose: () => void;
  /** Jump to a result page; parent flashes the match on the page. */
  onJumpTo: (page: number, query: string) => void;
}

function SnippetText({
  segments,
  theme,
  styles,
}: {
  segments: SnippetSegment[];
  theme: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Text style={[styles.snippet, { color: theme.inkMuted }]} numberOfLines={2}>
      {segments.map((s, i) => (
        <Text key={i} style={s.match ? { color: theme.accent } : undefined}>
          {s.text}
        </Text>
      ))}
    </Text>
  );
}

export function SearchUI({ bookId, onClose, onJumpTo }: SearchUIProps) {
  const { colors: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [matchIdx, setMatchIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const runSearch = useCallback(
    (q: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const trimmed = q.trim();
        if (!trimmed) {
          setResults([]);
          setMatchIdx(0);
          return;
        }
        setSearching(true);
        searchBook(bookId, trimmed)
          .then((rows) => {
            setResults(rows);
            setMatchIdx(0);
          })
          .catch(() => setResults([]))
          .finally(() => setSearching(false));
      }, DEBOUNCE_MS);
    },
    [bookId],
  );

  const onChangeText = useCallback(
    (q: string) => {
      setQuery(q);
      runSearch(q);
    },
    [runSearch],
  );

  const jumpTo = useCallback(
    (idx: number) => {
      const r = results[idx];
      if (!r) return;
      setMatchIdx(idx);
      onJumpTo(r.page, query.trim());
    },
    [results, query, onJumpTo],
  );

  const prev = useCallback(() => {
    if (results.length === 0) return;
    jumpTo((matchIdx - 1 + results.length) % results.length);
  }, [results, matchIdx, jumpTo]);

  const next = useCallback(() => {
    if (results.length === 0) return;
    jumpTo((matchIdx + 1) % results.length);
  }, [results, matchIdx, jumpTo]);

  const matchLabel = useMemo(() => {
    if (results.length === 0) return query.trim() && !searching ? 'no matches' : '';
    return `${matchIdx + 1} / ${results.length}`;
  }, [results.length, matchIdx, query, searching]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onChangeText}
          placeholder="Search in this book"
          placeholderTextColor={theme.inkMuted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          accessibilityLabel="Search in this book"
        />
        <Pressable
          style={styles.arrowButton}
          onPress={prev}
          disabled={results.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Previous match"
        >
          <Text style={[styles.arrow, results.length === 0 && styles.disabled]}>‹</Text>
        </Pressable>
        <Pressable
          style={styles.arrowButton}
          onPress={next}
          disabled={results.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Next match"
        >
          <Text style={[styles.arrow, results.length === 0 && styles.disabled]}>›</Text>
        </Pressable>
        <Pressable style={styles.closeButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close search">
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {matchLabel ? (
        <Text style={styles.matchLabel}>{matchLabel}</Text>
      ) : null}

      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.page}-${i}`}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        renderItem={({ item, index }) => (
          <Pressable
            style={[styles.row, index === matchIdx && { backgroundColor: theme.surface }]}
            onPress={() => jumpTo(index)}
            accessibilityRole="button"
            accessibilityLabel={`Go to page ${item.page}`}
          >
            <Text style={styles.pageNo}>p.{item.page}</Text>
            <SnippetText segments={parseSnippet(item.snippet)} theme={theme} styles={styles} />
          </Pressable>
        )}
      />
    </View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    root: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      maxHeight: '62%',
      backgroundColor: theme.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      zIndex: 30,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingHorizontal: spacing.sm,
    },
    input: {
      flex: 1,
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.ink,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    arrowButton: {
      width: 40,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    arrow: {
      fontFamily: fontFamilies.sans,
      fontSize: 26,
      color: theme.ink,
    },
    disabled: {
      opacity: 0.25,
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
    matchLabel: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
      paddingHorizontal: spacing.gutter,
      paddingBottom: spacing.xs,
    },
    list: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.rule,
    },
    row: {
      flexDirection: 'row',
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.gutter,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      gap: spacing.md,
      alignItems: 'flex-start',
    },
    pageNo: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.small,
      letterSpacing: monoLetterSpacing,
      color: theme.ink,
      paddingTop: 2,
      minWidth: 52,
    },
    snippet: {
      flex: 1,
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      lineHeight: typeScale.small * 1.4,
    },
  });
}
