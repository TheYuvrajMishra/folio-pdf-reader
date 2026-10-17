/**
 * Scrubber.tsx — bottom page scrubber (PRD §6.2, DESIGN §6.2).
 *
 * Custom-built (no Slider dependency): a track with page ticks, a thumb that
 * follows the finger, and a mono readout `p. 124 / 412 · 30%`. Dragging
 * scrubs the readout live; the page commits on release.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { pageToX, xToPage } from './readerMath';
import { fontFamilies } from '../theme/fonts';
import {
  monoLetterSpacing,
  spacing,
  typeScale,
  type ThemeColors,
} from '../theme/tokens';
import { useTheme } from '../theme/themeStore';

interface ScrubberProps {
  page: number;
  pageCount: number;
  /** Called once per release with the committed page. */
  onScrubTo: (page: number) => void;
}

/** Ticks: roughly one per 10 pages, capped so they stay readable. */
function tickPages(pageCount: number): number[] {
  const step = Math.max(1, Math.round(pageCount / 40));
  const ticks: number[] = [];
  for (let p = step; p < pageCount; p += step) ticks.push(p);
  return ticks;
}

export function Scrubber({ page, pageCount, onScrubTo }: ScrubberProps) {
  const { colors: theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubPage, setScrubPage] = useState(page);
  const [trackWidth, setTrackWidth] = useState(0);
  const scrubPageRef = useRef(page);
  const trackW = useSharedValue(0);
  const ticks = tickPages(pageCount);

  const shown = scrubbing ? scrubPage : page;
  const pct = pageCount > 1 ? Math.round(((shown - 1) / (pageCount - 1)) * 100) : 0;

  // JS-side handlers (crossed from the worklet via runOnJS).
  const begin = useCallback(
    (x: number) => {
      const p = xToPage(x, trackW.value, pageCount);
      scrubPageRef.current = p;
      setScrubbing(true);
      setScrubPage(p);
    },
    [pageCount, trackW],
  );
  const move = useCallback(
    (x: number) => {
      const p = xToPage(x, trackW.value, pageCount);
      scrubPageRef.current = p;
      setScrubPage(p);
    },
    [pageCount, trackW],
  );
  const finish = useCallback(() => {
    setScrubbing(false);
    onScrubTo(scrubPageRef.current);
  }, [onScrubTo]);

  // The gesture must be stable across renders: setScrubPage re-renders on
  // every move, and a fresh gesture object would cancel the active drag.
  // The worklets delegate to the latest callbacks through a ref.
  const cbRef = useRef({ begin, move, finish });
  cbRef.current = { begin, move, finish };

  const beginJS = (x: number): void => {
    cbRef.current.begin(x);
  };
  const moveJS = (x: number): void => {
    cbRef.current.move(x);
  };
  const finishJS = (): void => {
    cbRef.current.finish();
  };

  const drag = useMemo(
    () =>
      Gesture.Pan()
        .onBegin((e) => {
          'worklet';
          runOnJS(beginJS)(e.x);
        })
        .onUpdate((e) => {
          'worklet';
          runOnJS(moveJS)(e.x);
        })
        .onFinalize(() => {
          'worklet';
          runOnJS(finishJS)();
        }),
    [],
  );

  const thumbX = pageToX(shown, trackWidth, pageCount);

  return (
    <View style={styles.root}>
      <GestureDetector gesture={drag}>
        <View
          style={styles.hit}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            trackW.value = w;
            setTrackWidth(w);
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Scrubber, page ${shown} of ${pageCount}`}
          accessibilityValue={{ min: 1, max: pageCount, now: shown }}
        >
          <View style={styles.track}>
            {ticks.map((p) => (
              <View key={p} style={[styles.tick, { left: `${(p / pageCount) * 100}%` }]} />
            ))}
            <View style={[styles.fill, { width: `${(shown / pageCount) * 100}%` }]} />
          </View>
          <View style={[styles.thumb, { left: thumbX - 7 }]} />
        </View>
      </GestureDetector>
      <Text style={styles.label} numberOfLines={1}>
        p. {shown} / {pageCount} · {pct}%
      </Text>
    </View>
  );
}

function createStyles(theme: ThemeColors) {
  return StyleSheet.create({
    root: {
      paddingHorizontal: spacing.readerGutter,
      paddingBottom: spacing.sm,
    },
  hit: {
    height: 44, // generous touch target (DESIGN §12: ≥ 48dp where possible)
    justifyContent: 'center',
  },
  track: {
    height: 3,
    borderRadius: 2,
    backgroundColor: theme.rule,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.accent,
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.inkMuted,
    opacity: 0.6,
  },
  thumb: {
    position: 'absolute',
    top: 15, // (44 - 14) / 2
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.ink,
  },
  label: {
    marginTop: spacing.xs,
    textAlign: 'center',
    fontFamily: fontFamilies.mono,
    fontSize: typeScale.small,
    letterSpacing: monoLetterSpacing,
    color: theme.inkMuted,
  },
  });
}
