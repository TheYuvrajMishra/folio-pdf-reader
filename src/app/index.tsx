/**
 * Folio library screen (M1). DESIGN.md §6.1.
 *
 * "FOLIO" header + hairline, a "continue" hero for the most recent book,
 * a 3-column shelf (grid/list toggle, recent/title/progress sort), a (+)
 * import FAB, long-press card menu (rename / reset progress / delete with
 * undo), and the "Nothing on the shelf." empty state.
 *
 * The reader route (src/app/reader/[id].tsx) is owned by the reader agent;
 * navigation there is cast until it lands. Progress comes from the resume
 * agent's src/data/positions.ts (async getPosition).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  listBooks,
  renameBook,
  resetProgress,
  softDeleteBook,
  touchBook,
  updateBook,
  type Book,
  type BookSort,
} from '../data/books';
import { getPosition, type SavedPosition } from '../data/positions';
import { importPdfFromPicker, importPdfFromUri } from '../library/import';
import { formatProgressMeta, progressPercent } from '../library/progress';
import { fontFamilies } from '../theme/fonts';
import {
  lineHeight,
  monoLetterSpacing,
  radii,
  spacing,
  typeScale,
  type ThemeColors,
} from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

interface BookVM {
  book: Book;
  position: SavedPosition | null;
  /** 0..1 */
  pct: number;
}

function openReader(id: string): void {
  // Cast: the reader route doesn't exist yet (reader agent owns it).
  (router.push as (href: string) => void)(`/reader/${id}`);
}

function trunc(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const SORTS: BookSort[] = ['recent', 'title', 'progress'];

export default function LibraryScreen() {
  const t = useTheme((s) => s.colors);
  const styles = useMemo(() => createStyles(t), [t]);
  const [books, setBooks] = useState<BookVM[]>([]);
  const [sort, setSort] = useState<BookSort>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [importing, setImporting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Book | null>(null);
  const [renameText, setRenameText] = useState('');
  const [snack, setSnack] = useState<{ id: string; title: string } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Incoming PDF shared from another app ("Open with" / share sheet),
  // routed here by the root layout as ?incoming=<uri>.
  const { incoming } = useLocalSearchParams<{ incoming?: string }>();
  const consumedIncoming = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await listBooks(sort);
      const vms = await Promise.all(
        rows.map(async (book): Promise<BookVM> => {
          let position: SavedPosition | null = null;
          try {
            position = await getPosition(book.id);
          } catch {
            position = null;
          }
          return {
            book,
            position,
            pct: progressPercent(position?.page ?? 0, book.pageCount),
          };
        }),
      );
      setBooks(vms);
    } catch (err) {
      console.warn('[folio] library load failed', err);
    }
  }, [sort]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const clearSnack = useCallback(() => {
    if (snackTimer.current) {
      clearTimeout(snackTimer.current);
      snackTimer.current = null;
    }
    setSnack(null);
  }, []);

  const showSnack = useCallback(
    (id: string, title: string) => {
      clearSnack();
      setSnack({ id, title });
      snackTimer.current = setTimeout(() => setSnack(null), 4500);
    },
    [clearSnack],
  );

  const doImport = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const book = await importPdfFromPicker();
      if (book) {
        await load();
      }
    } catch (err) {
      Alert.alert(
        'Import failed',
        err instanceof Error ? err.message : 'Could not import this PDF.',
      );
    } finally {
      setImporting(false);
    }
  }, [importing, load]);

  const openBook = useCallback((id: string) => {
    void touchBook(id).catch(() => undefined);
    openReader(id);
  }, []);

  // Import a PDF shared from another app ("Open with" / share sheet).
  // Routed here by the root layout as ?incoming=<uri>; consumed once per
  // URI so re-renders / refocuses don't re-import.
  useEffect(() => {
    const uri = typeof incoming === 'string' ? incoming : null;
    if (!uri || consumedIncoming.current === uri) return;
    consumedIncoming.current = uri;
    // Clear the param so a later back-navigation doesn't retrigger.
    router.setParams({ incoming: undefined });
    (async () => {
      setImporting(true);
      try {
        const book = await importPdfFromUri(uri);
        await load();
        openBook(book.id);
      } catch (err) {
        Alert.alert(
          'Import failed',
          err instanceof Error ? err.message : 'Could not import this PDF.',
        );
      } finally {
        setImporting(false);
      }
    })();
  }, [incoming, load, openBook]);

  const confirmReset = useCallback(
    (book: Book) => {
      Alert.alert(
        'Reset progress?',
        `Forget where you were in “${trunc(book.title, 40)}”?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset',
            style: 'destructive',
            onPress: () => {
              void resetProgress(book.id)
                .then(() => load())
                .catch((err) =>
                  Alert.alert('Reset failed', err instanceof Error ? err.message : ''),
                );
            },
          },
        ],
      );
    },
    [load],
  );

  const confirmDelete = useCallback(
    (book: Book) => {
      Alert.alert('Delete book?', `Remove “${trunc(book.title, 40)}” from the shelf?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void softDeleteBook(book.id)
              .then(() => load())
              .then(() => showSnack(book.id, book.title))
              .catch((err) =>
                Alert.alert('Delete failed', err instanceof Error ? err.message : ''),
              );
          },
        },
      ]);
    },
    [load, showSnack],
  );

  const cardMenu = useCallback(
    (book: Book) => {
      Alert.alert(book.title, undefined, [
        {
          text: 'Rename',
          onPress: () => {
            setRenameText(book.title);
            setRenameTarget(book);
          },
        },
        { text: 'Reset progress', onPress: () => confirmReset(book) },
        { text: 'Delete', style: 'destructive', onPress: () => confirmDelete(book) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    },
    [confirmDelete, confirmReset],
  );

  const saveRename = useCallback(async () => {
    if (!renameTarget) return;
    const title = renameText.trim();
    setRenameTarget(null);
    if (title.length === 0 || title === renameTarget.title) return;
    try {
      await renameBook(renameTarget.id, title);
      await load();
    } catch (err) {
      Alert.alert('Rename failed', err instanceof Error ? err.message : '');
    }
  }, [renameTarget, renameText, load]);

  const undoDelete = useCallback(async () => {
    if (!snack) return;
    const id = snack.id;
    clearSnack();
    try {
      await updateBook(id, { deletedAt: null });
      await load();
    } catch (err) {
      Alert.alert('Undo failed', err instanceof Error ? err.message : '');
    }
  }, [snack, clearSnack, load]);

  // "Continue" hero: most recently touched book, whatever the shelf sort.
  const hero: BookVM | null = books.reduce<BookVM | null>((best, vm) => {
    if (!best) return vm;
    const key = (v: BookVM) => v.book.lastOpenedAt ?? v.book.addedAt ?? 0;
    return key(vm) > key(best) ? vm : best;
  }, null);

  const renderGridCard = ({ item }: { item: BookVM }) => (
    <Pressable
      style={styles.card}
      onPress={() => openBook(item.book.id)}
      onLongPress={() => cardMenu(item.book)}
      accessibilityRole="button"
      accessibilityLabel={item.book.title}>
      <View style={styles.coverWrap}>
        {item.book.coverPath ? (
          <Image
            source={{ uri: item.book.coverPath }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverInitial}>
              {(item.book.title.trim()[0] ?? '·').toUpperCase()}
            </Text>
          </View>
        )}
        <View
          style={[styles.progressLine, { width: `${Math.round(item.pct * 100)}%` }]}
        />
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.book.title}
      </Text>
      <Text style={styles.cardMeta}>
        {item.book.pageCount ? `${item.book.pageCount}p` : 'indexing…'}
      </Text>
    </Pressable>
  );

  const renderListRow = ({ item }: { item: BookVM }) => (
    <Pressable
      style={styles.row}
      onPress={() => openBook(item.book.id)}
      onLongPress={() => cardMenu(item.book)}
      accessibilityRole="button"
      accessibilityLabel={item.book.title}>
      <View style={styles.rowCover}>
        {item.book.coverPath ? (
          <Image
            source={{ uri: item.book.coverPath }}
            style={styles.cover}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.cover, styles.coverPlaceholder]}>
            <Text style={styles.coverInitial}>
              {(item.book.title.trim()[0] ?? '·').toUpperCase()}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.rowInfo}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {item.book.title}
        </Text>
        <Text style={styles.cardMeta}>
          {formatProgressMeta(item.position?.page ?? 0, item.book.pageCount)}
        </Text>
        <View style={styles.rowProgressTrack}>
          <View
            style={[styles.rowProgressFill, { width: `${Math.round(item.pct * 100)}%` }]}
          />
        </View>
      </View>
    </Pressable>
  );

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

      {hero && (
        <View>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionLabel}>continue</Text>
          </View>
          <View style={styles.hero}>
            <View style={styles.heroCover}>
              {hero.book.coverPath ? (
                <Image
                  source={{ uri: hero.book.coverPath }}
                  style={styles.cover}
                  contentFit="cover"
                />
              ) : (
                <View style={[styles.cover, styles.coverPlaceholder]}>
                  <Text style={styles.coverInitial}>
                    {(hero.book.title.trim()[0] ?? '·').toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroTitle} numberOfLines={3}>
                {hero.book.title}
              </Text>
              <Text style={styles.heroMeta}>
                {formatProgressMeta(hero.position?.page ?? 0, hero.book.pageCount)}
              </Text>
              {hero.position && hero.position.snippet ? (
                <Text style={styles.heroSnippet} numberOfLines={1}>
                  {`line ${hero.position.line_index} · “${trunc(hero.position.snippet, 28)}”`}
                </Text>
              ) : null}
              <Pressable
                style={styles.resumeButton}
                onPress={() => openBook(hero.book.id)}
                accessibilityRole="button"
                accessibilityLabel={`Resume ${hero.book.title}`}>
                <Text style={styles.resumeText}>resume ▸</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.headerRule} />
        </View>
      )}

      <View style={styles.sectionRow}>
        <Text style={styles.sectionLabel}>shelf</Text>
        <View style={styles.viewToggle}>
          <Pressable onPress={() => setView('grid')} accessibilityRole="button">
            <Text style={[styles.toggleText, view === 'grid' && styles.toggleActive]}>
              grid
            </Text>
          </Pressable>
          <Text style={styles.toggleSep}>|</Text>
          <Pressable onPress={() => setView('list')} accessibilityRole="button">
            <Text style={[styles.toggleText, view === 'list' && styles.toggleActive]}>
              list
            </Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s}
            onPress={() => setSort(s)}
            style={[styles.sortChip, sort === s && styles.sortChipActive]}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${s}`}>
            <Text style={[styles.sortText, sort === s && styles.sortTextActive]}>{s}</Text>
          </Pressable>
        ))}
      </View>

      {books.length === 0 ? (
        <View style={styles.empty} accessibilityLabel="Nothing on the shelf.">
          <Text style={styles.emptySerif}>Nothing on the shelf.</Text>
          <Pressable
            style={styles.importButton}
            onPress={doImport}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel="Import a PDF">
            <Text style={styles.importButtonText}>
              {importing ? 'Importing…' : 'Import a PDF'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          key={view}
          data={books}
          keyExtractor={(item) => item.book.id}
          numColumns={view === 'grid' ? 3 : 1}
          columnWrapperStyle={view === 'grid' ? styles.gridRow : undefined}
          renderItem={view === 'grid' ? renderGridCard : renderListRow}
          contentContainerStyle={styles.listContent}
        />
      )}

      <Pressable
        style={[styles.fab, importing && styles.fabDisabled]}
        onPress={doImport}
        disabled={importing}
        accessibilityRole="button"
        accessibilityLabel="Import a PDF">
        <Text style={styles.fabText}>{importing ? '(…)' : '(+)'}</Text>
      </Pressable>

      {/* Rename sheet (Alert.prompt is iOS-only; this works on both). */}
      <Modal visible={renameTarget !== null} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameTarget(null)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalLabel}>rename</Text>
            <TextInput
              style={styles.renameInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void saveRename()}
              accessibilityLabel="Book title"
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenameTarget(null)} accessibilityRole="button">
                <Text style={styles.modalCancel}>cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => void saveRename()}
                accessibilityRole="button"
                accessibilityLabel="Save new title">
                <Text style={styles.modalSave}>save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Delete undo snackbar. */}
      {snack && (
        <View style={styles.snack}>
          <Text style={styles.snackText} numberOfLines={1}>
            {`Deleted “${trunc(snack.title, 32)}”`}
          </Text>
          <Pressable onPress={() => void undoDelete()} accessibilityRole="button">
            <Text style={styles.snackUndo}>undo</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(t: ThemeColors) {
  return StyleSheet.create({
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
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: t.inkMuted,
  },
  hero: {
    flexDirection: 'row',
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  heroCover: {
    width: 84,
    aspectRatio: 2 / 3,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    overflow: 'hidden',
  },
  heroInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  heroTitle: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title2,
    lineHeight: typeScale.title2 * lineHeight.title,
    color: t.ink,
  },
  heroMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: t.ink,
  },
  heroSnippet: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.small,
    color: t.inkMuted,
  },
  resumeButton: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: t.accent,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  resumeText: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: t.accent,
  },
  viewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  toggleText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: t.inkMuted,
  },
  toggleActive: {
    color: t.accent,
  },
  toggleSep: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    color: t.rule,
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.gutter,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  sortChip: {
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  sortChipActive: {
    borderColor: t.accent,
  },
  sortText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: t.inkMuted,
  },
  sortTextActive: {
    color: t.accent,
  },
  listContent: {
    paddingHorizontal: spacing.gutter,
    paddingBottom: 120,
  },
  gridRow: {
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  card: {
    flex: 1,
    gap: spacing.xs,
  },
  coverWrap: {
    aspectRatio: 2 / 3,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    overflow: 'hidden',
    backgroundColor: t.surface,
  },
  cover: {
    width: '100%',
    height: '100%',
  },
  coverPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverInitial: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title1,
    color: t.inkMuted,
  },
  progressLine: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    backgroundColor: t.accent,
  },
  cardTitle: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.small,
    lineHeight: typeScale.small * lineHeight.ui,
    color: t.ink,
  },
  cardMeta: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.caption,
    letterSpacing: monoLetterSpacing,
    color: t.inkMuted,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.rule,
  },
  rowCover: {
    width: 44,
    aspectRatio: 2 / 3,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    overflow: 'hidden',
    backgroundColor: t.surface,
  },
  rowInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  rowTitle: {
    fontFamily: fontFamilies.serif,
    fontSize: typeScale.title3,
    color: t.ink,
  },
  rowProgressTrack: {
    height: 2,
    backgroundColor: t.rule,
    borderRadius: 1,
    overflow: 'hidden',
  },
  rowProgressFill: {
    height: 2,
    backgroundColor: t.accent,
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
  fabDisabled: {
    opacity: 0.5,
  },
  fabText: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.body,
    letterSpacing: monoLetterSpacing,
    color: t.ink,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalLabel: {
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: t.inkMuted,
  },
  renameInput: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: t.ink,
    borderBottomWidth: 1,
    borderBottomColor: t.accent,
    paddingVertical: spacing.sm,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
  },
  modalCancel: {
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.body,
    color: t.inkMuted,
    paddingVertical: spacing.sm,
  },
  modalSave: {
    fontFamily: fontFamilies.sans,
    fontWeight: '600',
    fontSize: typeScale.body,
    color: t.accent,
    paddingVertical: spacing.sm,
  },
  snack: {
    position: 'absolute',
    left: spacing.gutter,
    right: spacing.gutter,
    bottom: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.rule,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  snackText: {
    flex: 1,
    fontFamily: fontFamilies.sans,
    fontSize: typeScale.small,
    color: t.ink,
  },
  snackUndo: {
    fontFamily: fontFamilies.sans,
    fontWeight: '600',
    fontSize: typeScale.body,
    color: t.accent,
  },
});
}