/**
 * ContentsSheet.tsx — full-height sheet (M5, DESIGN §6.5).
 *
 * Tabs: Contents · Bookmarks · Highlights · Pages. Notebook margin rule
 * (1 px vertical hairline at x = 20). Header action: Export → the parent
 * opens ExportSheet.
 *
 * - Contents: PDF outline tree via the engine's getOutline(). Tap a row to
 *   jump; destJson may be null or unresolvable (named dests / page refs) →
 *   best-effort `resolveOutlinePage`, else a disabled row.
 * - Bookmarks: bookmarks table + "add bookmark here" (page-level).
 * - Highlights: annotations from the annotations agent's store (defensive
 *   load — see reader/integrations.ts). Mono p.N, color chip, excerpt in
 *   serif 15, note in italic; swipe-left deletes with an Undo snackbar;
 *   tap jumps to the page and pulses the annotation.
 * - Pages: page-number grid (thumbnail grid is the P1 upgrade path — the
 *   raster cache in bookSession already stores per-page webp files, so a
 *   future pass can swap cells to <Image> without touching this layout).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OutlineNode } from '../engine/protocol';
import { getEngine } from '../engine/engineHost';
import { resolveOutlinePage } from './outline';
import { deriveExcerpt, fetchPageLines } from '../export/export';
import { fontFamilies } from '../theme/fonts';
import { monoLetterSpacing, spacing, typeScale, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/themeStore';
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  type Bookmark,
} from '../data/bookmarks';
import { loadAnnotationStore, type StoreAnnotation } from './integrations';
export type ContentsTab = 'contents' | 'bookmarks' | 'highlights' | 'pages';

export interface HighlightItem {
  id: string;
  page: number;
  type: string;
  color: string;
  excerpt: string;
  note: string | null;
  rects: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  source: StoreAnnotation;
}

interface ContentsSheetProps {
  bookId: string;
  bookTitle: string;
  /** Current reader page (bookmark target, highlight-context). */
  page: number;
  pageCount: number;
  visible: boolean;
  initialTab?: ContentsTab;
  onClose: () => void;
  onJumpToPage: (page: number) => void;
  /** Tap on a highlight: jump + pulse the annotation. */
  onSelectHighlight: (item: HighlightItem) => void;
  /** Header export action: parent opens ExportSheet. */
  onExport: () => void;
}

/**
 * Best-effort outline → page resolution. Re-exported for convenience; the
 * implementation lives in ./outline (pure, unit-tested) so ContentsSheet's
 * react-native imports stay out of the Node test path.
 */
export { resolveOutlinePage } from './outline';

/** Width of the revealed delete action. */
const DELETE_WIDTH = 84;

/**
 * Swipe-left-to-delete row (RNGH v3 has no Swipeable export, so this is a
 * small Pan-gesture implementation: horizontal pan reveals the delete action
 * behind the row; vertical movement fails the gesture so lists still scroll).
 */
function SwipeRow({
  onDelete,
  deleteLabel,
  styles,
  children,
}: {
  onDelete: () => void;
  deleteLabel: string;
  styles: ReturnType<typeof createStyles>;
  children: React.ReactNode;
}) {
  const tx = useSharedValue(0);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-12, 12])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          'worklet';
          tx.value = Math.min(0, Math.max(-DELETE_WIDTH, e.translationX));
        })
        .onEnd(() => {
          'worklet';
          tx.value = withTiming(tx.value < -DELETE_WIDTH / 2 ? -DELETE_WIDTH : 0, {
            duration: 160,
          });
        }),
    [tx],
  );
  const anim = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeBehind}>
        <Pressable
          style={styles.deleteAction}
          onPress={() => {
            tx.value = withTiming(0, { duration: 160 });
            onDelete();
          }}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Text style={styles.deleteActionText}>delete</Text>
        </Pressable>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.swipeFront, anim]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const TABS: Array<{ id: ContentsTab; label: string }> = [
  { id: 'contents', label: 'Contents' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'pages', label: 'Pages' },
];

interface SnackbarState {
  message: string;
  onUndo: (() => void) | null;
}

export function ContentsSheet({
  bookId,
  bookTitle,
  page,
  pageCount,
  visible,
  initialTab = 'contents',
  onClose,
  onJumpToPage,
  onSelectHighlight,
  onExport,
}: ContentsSheetProps) {
  const { colors: theme } = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<ContentsTab>(initialTab);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [highlights, setHighlights] = useState<HighlightItem[]>([]);
  const [highlightsReady, setHighlightsReady] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarState | null>(null);
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styles = useMemo(() => createStyles(theme), [theme]);

  useEffect(() => {
    if (visible) setTab(initialTab);
  }, [visible, initialTab]);

  useEffect(
    () => () => {
      if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    },
    [],
  );

  const showSnackbar = useCallback((message: string, onUndo: (() => void) | null) => {
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    setSnackbar({ message, onUndo });
    snackbarTimer.current = setTimeout(() => setSnackbar(null), 4000);
  }, []);

  // --- contents ---------------------------------------------------------
  useEffect(() => {
    if (!visible || tab !== 'contents') return;
    let cancelled = false;
    setOutline(null);
    getEngine()
      .getOutline()
      .then((nodes) => {
        if (!cancelled) setOutline(nodes ?? []);
      })
      .catch(() => {
        if (!cancelled) setOutline([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tab]);

  // --- bookmarks ---------------------------------------------------------
  const reloadBookmarks = useCallback(() => {
    listBookmarks(bookId)
      .then(setBookmarks)
      .catch(() => setBookmarks([]));
  }, [bookId]);

  useEffect(() => {
    if (visible && tab === 'bookmarks') reloadBookmarks();
  }, [visible, tab, reloadBookmarks]);

  const onAddBookmarkHere = useCallback(() => {
    addBookmark(bookId, page)
      .then(() => reloadBookmarks())
      .catch(() => undefined);
  }, [bookId, page, reloadBookmarks]);

  const onDeleteBookmark = useCallback(
    (b: Bookmark) => {
      setBookmarks((cur) => cur.filter((x) => x.id !== b.id));
      removeBookmark(bookId, b.id).catch(() => undefined);
      showSnackbar('Bookmark removed', () => {
        addBookmark(bookId, b.page, b.label)
          .then(() => reloadBookmarks())
          .catch(() => undefined);
      });
    },
    [bookId, reloadBookmarks, showSnackbar],
  );

  // --- highlights ---------------------------------------------------------
  const reloadHighlights = useCallback(async () => {
    const store = await loadAnnotationStore(bookId);
    if (!store) return [];
    const rows = await store.listAllAnnotations().catch(() => []);
    const lineCache = new Map<number, Awaited<ReturnType<typeof fetchPageLines>>>();
    const items: HighlightItem[] = [];
    const sorted = [...rows].sort((a, b) => a.page - b.page);
    for (const r of sorted) {
      let lines = lineCache.get(r.page);
      if (!lines) {
        lines = await fetchPageLines(bookId, r.page);
        lineCache.set(r.page, lines);
      }
      items.push({
        id: r.id,
        page: r.page,
        type: r.type,
        color: r.color,
        excerpt: deriveExcerpt(
          {
            id: r.id,
            book_id: r.book_id,
            page: r.page,
            type: r.type,
            color: r.color,
            opacity: r.opacity,
            dataJson: r.dataJson,
            note: r.note,
          },
          lines,
        ),
        note: r.note?.trim() ? r.note.trim() : null,
        rects: Array.isArray(r.dataJson?.rects) ? r.dataJson.rects : [],
        source: r,
      });
    }
    return items;
  }, [bookId]);

  useEffect(() => {
    if (!visible || tab !== 'highlights') return;
    let cancelled = false;
    setHighlightsReady(false);
    reloadHighlights()
      .then((items) => {
        if (!cancelled) {
          setHighlights(items);
          setHighlightsReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlights([]);
          setHighlightsReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tab, reloadHighlights]);

  const onDeleteHighlight = useCallback(
    async (item: HighlightItem) => {
      const store = await loadAnnotationStore(bookId);
      if (!store) return; // contract absent: no delete UI
      setHighlights((cur) => cur.filter((x) => x.id !== item.id));
      const deleted = await store.deleteAnnotation(item.id).catch(() => null);
      if (!deleted) {
        // Delete failed: restore the row.
        setHighlights((cur) => [...cur, item].sort((a, b) => a.page - b.page));
        return;
      }
      // Undo goes through the store's own op log (M4 persistent undo/redo),
      // then refreshes the list.
      showSnackbar('Highlight removed', () => {
        store
          .undo()
          .then(() => reloadHighlights())
          .then((items) => {
            setHighlights(items);
          })
          .catch(() => undefined);
      });
    },
    [bookId, reloadHighlights, showSnackbar],
  );

  // --- renderers ------------------------------------------------------------
  const renderOutlineNode = useCallback(
    (node: OutlineNode, depth: number, theme: ThemeColors) => {
      const target = resolveOutlinePage(node.destJson);
      const disabled = target == null;
      return (
        <View key={`${node.title}-${depth}`}>
          <Pressable
            style={[styles.outlineRow, { paddingLeft: spacing.gutter + depth * 16 }]}
            disabled={disabled}
            onPress={() => target != null && onJumpToPage(target)}
            accessibilityRole="button"
            accessibilityLabel={disabled ? node.title : `${node.title}, page ${target}`}
          >
            <Text
              style={[styles.outlineTitle, disabled && styles.disabledText]}
              numberOfLines={2}
            >
              {node.title}
            </Text>
            {target != null ? <Text style={styles.outlinePage}>p.{target}</Text> : null}
          </Pressable>
          {node.children.map((c) => renderOutlineNode(c, depth + 1, theme))}
        </View>
      );
    },
    [styles, onJumpToPage],
  );

  const [canDeleteHighlights, setCanDeleteHighlights] = useState(false);
  useEffect(() => {
    if (visible && tab === 'highlights') {
      loadAnnotationStore(bookId).then((s) => setCanDeleteHighlights(s !== null));
    }
  }, [visible, tab, bookId]);

  const renderBody = () => {
    switch (tab) {
      case 'contents':
        if (outline === null) {
          return <Text style={styles.emptyText}>Loading contents…</Text>;
        }
        if (outline.length === 0) {
          return <Text style={styles.emptyText}>No table of contents in this book.</Text>;
        }
        return (
          <ScrollView contentContainerStyle={styles.scrollPad}>
            {outline.map((n) => renderOutlineNode(n, 0, theme))}
          </ScrollView>
        );

      case 'bookmarks':
        return (
          <ScrollView contentContainerStyle={styles.scrollPad}>
            <Pressable
              style={styles.addBookmark}
              onPress={onAddBookmarkHere}
              accessibilityRole="button"
              accessibilityLabel={`Add bookmark at page ${page}`}
            >
              <Text style={styles.addBookmarkText}>+ bookmark this page · p.{page}</Text>
            </Pressable>
            {bookmarks.length === 0 ? (
              <Text style={styles.emptyText}>No bookmarks yet.</Text>
            ) : (
              bookmarks.map((b) => (
                <SwipeRow
                  key={b.id}
                  onDelete={() => onDeleteBookmark(b)}
                  deleteLabel="Delete bookmark"
                  styles={styles}
                >
                  <Pressable
                    style={styles.bookmarkRow}
                    onPress={() => onJumpToPage(b.page)}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to bookmark, page ${b.page}`}
                  >
                    <Text style={styles.pageNo}>p.{b.page}</Text>
                    <Text style={styles.bookmarkLabel} numberOfLines={1}>
                      {b.label?.trim() ? b.label : bookTitle}
                    </Text>
                  </Pressable>
                </SwipeRow>
              ))
            )}
          </ScrollView>
        );

      case 'highlights':
        if (!highlightsReady) {
          return <Text style={styles.emptyText}>Loading highlights…</Text>;
        }
        if (highlights.length === 0) {
          return (
            <Text style={styles.emptyText}>
              No highlights yet. Long-press text in the reader to mark it.
            </Text>
          );
        }
        return (
          <FlatList
            data={highlights}
            keyExtractor={(h) => h.id}
            contentContainerStyle={styles.scrollPad}
            renderItem={({ item }) => {
              const row = (
                <Pressable
                  style={styles.highlightRow}
                  onPress={() => onSelectHighlight(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to highlight on page ${item.page}`}
                >
                  <View style={styles.highlightMeta}>
                    <Text style={styles.pageNo}>p.{item.page}</Text>
                    <View
                      style={[styles.colorChip, { backgroundColor: item.color }]}
                    />
                    <Text style={styles.highlightType}>{item.type}</Text>
                  </View>
                  <Text style={styles.excerpt} numberOfLines={3}>
                    {item.excerpt}
                  </Text>
                  {item.note ? (
                    <Text style={styles.note} numberOfLines={3}>
                      {item.note}
                    </Text>
                  ) : null}
                </Pressable>
              );
              return canDeleteHighlights ? (
                <SwipeRow
                  onDelete={() => onDeleteHighlight(item)}
                  deleteLabel="Delete highlight"
                  styles={styles}
                >
                  {row}
                </SwipeRow>
              ) : (
                row
              );
            }}
          />
        );

      case 'pages': {
        const cells = Array.from({ length: pageCount }, (_, i) => i + 1);
        return (
          <FlatList
            data={cells}
            keyExtractor={(p) => `${p}`}
            numColumns={5}
            contentContainerStyle={styles.gridPad}
            renderItem={({ item: p }) => (
              <Pressable
                style={[styles.pageCell, p === page && styles.pageCellActive]}
                onPress={() => onJumpToPage(p)}
                accessibilityRole="button"
                accessibilityLabel={`Go to page ${p}`}
              >
                <Text style={[styles.pageCellText, p === page && styles.pageCellTextActive]}>
                  {p}
                </Text>
              </Pressable>
            )}
          />
        );
      }
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          {/* notebook margin rule (DESIGN §5) */}
          <View style={styles.marginRule} pointerEvents="none" />

          <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
            <Pressable
              style={styles.headerButton}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.headerButtonText}>✕</Text>
            </Pressable>
            <Text style={styles.headerTitle} numberOfLines={1}>
              contents
            </Text>
            <Pressable
              style={styles.headerButton}
              onPress={onExport}
              accessibilityRole="button"
              accessibilityLabel="Export highlights"
            >
              <Text style={[styles.headerButtonText, styles.exportText]}>export</Text>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable
                key={t.id}
                style={styles.tab}
                onPress={() => setTab(t.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.id }}
                accessibilityLabel={t.label}
              >
                <Text style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}>
                  {t.label}
                </Text>
                {tab === t.id ? <View style={styles.tabRule} /> : null}
              </Pressable>
            ))}
          </View>

          <View style={styles.body}>{renderBody()}</View>

          {snackbar ? (
            <View style={styles.snackbar}>
              <Text style={styles.snackbarText}>{snackbar.message}</Text>
              {snackbar.onUndo ? (
                <Pressable
                  onPress={() => {
                    setSnackbar(null);
                    snackbar.onUndo?.();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Undo delete"
                >
                  <Text style={styles.snackbarUndo}>undo</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)', // DESIGN §7: 40% scrim
      justifyContent: 'flex-end',
    },
    backdropTap: {
      flex: 1,
    },
    sheet: {
      height: '92%',
      backgroundColor: theme.bg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.rule,
    },
    marginRule: {
      position: 'absolute',
      left: 20,
      top: 0,
      bottom: 0,
      width: StyleSheet.hairlineWidth,
      backgroundColor: theme.rule,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      minHeight: 56,
    },
    headerButton: {
      width: 64,
      height: 48,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButtonText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.inkMuted,
    },
    exportText: {
      color: theme.accent,
      fontSize: typeScale.small,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontFamily: fontFamilies.serif,
      fontSize: typeScale.title2,
      color: theme.ink,
    },
    tabs: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
    },
    tab: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    tabLabel: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.inkMuted,
    },
    tabLabelActive: {
      color: theme.ink,
      fontWeight: '600',
    },
    tabRule: {
      position: 'absolute',
      bottom: 0,
      height: 2,
      width: '60%',
      backgroundColor: theme.accent,
    },
    body: {
      flex: 1,
    },
    scrollPad: {
      paddingBottom: spacing.xxxl,
    },
    gridPad: {
      paddingHorizontal: spacing.gutter,
      paddingTop: spacing.md,
      paddingBottom: spacing.xxxl,
    },
    emptyText: {
      fontFamily: fontFamilies.serif,
      fontSize: typeScale.title3,
      color: theme.inkMuted,
      textAlign: 'center',
      marginTop: spacing.xxxl,
      paddingHorizontal: spacing.xxxl,
      lineHeight: typeScale.title3 * 1.4,
    },
    // contents
    outlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
      paddingRight: spacing.gutter,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      gap: spacing.md,
    },
    outlineTitle: {
      flex: 1,
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.ink,
      lineHeight: typeScale.body * 1.3,
    },
    outlinePage: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.small,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
    },
    disabledText: {
      opacity: 0.45,
    },
    // bookmarks
    addBookmark: {
      marginHorizontal: spacing.gutter,
      marginTop: spacing.md,
      marginBottom: spacing.sm,
      paddingVertical: spacing.md,
      alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.accent,
      borderRadius: 999,
    },
    addBookmarkText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.accent,
    },
    bookmarkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.gutter,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      gap: spacing.md,
      backgroundColor: theme.bg,
    },
    bookmarkLabel: {
      flex: 1,
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.body,
      color: theme.ink,
    },
    pageNo: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.small,
      letterSpacing: monoLetterSpacing,
      color: theme.ink,
      minWidth: 52,
    },
    // highlights
    highlightRow: {
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.gutter,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.rule,
      gap: spacing.xs,
      backgroundColor: theme.bg,
    },
    highlightMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    colorChip: {
      width: 12,
      height: 12,
      borderRadius: 6,
    },
    highlightType: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.caption,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
    },
    excerpt: {
      fontFamily: fontFamilies.serif,
      fontSize: typeScale.body,
      color: theme.ink,
      lineHeight: typeScale.body * 1.4,
    },
    note: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      fontStyle: 'italic',
      color: theme.inkMuted,
      lineHeight: typeScale.small * 1.4,
    },
    deleteAction: {
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingRight: spacing.gutter,
      width: DELETE_WIDTH,
      height: '100%',
      backgroundColor: theme.danger,
    },
    deleteActionText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: '#FFFFFF',
    },
    swipeWrap: {
      position: 'relative',
    },
    swipeBehind: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'flex-end',
      justifyContent: 'center',
    },
    swipeFront: {
      backgroundColor: theme.bg,
    },
    // pages grid
    pageCell: {
      flex: 1,
      aspectRatio: 1,
      margin: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.rule,
    },
    pageCellActive: {
      borderColor: theme.accent,
    },
    pageCellText: {
      fontFamily: fontFamilies.mono,
      fontSize: typeScale.small,
      letterSpacing: monoLetterSpacing,
      color: theme.inkMuted,
    },
    pageCellTextActive: {
      color: theme.accent,
    },
    // snackbar
    snackbar: {
      position: 'absolute',
      left: spacing.gutter,
      right: spacing.gutter,
      bottom: spacing.xl,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.rule,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    snackbarText: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.ink,
    },
    snackbarUndo: {
      fontFamily: fontFamilies.sans,
      fontSize: typeScale.small,
      color: theme.accent,
      fontWeight: '600',
    },
  });
}
