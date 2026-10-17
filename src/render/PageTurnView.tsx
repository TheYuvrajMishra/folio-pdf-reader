/**
 * PageTurnView.tsx — Skia page-transition renderer (M2).
 *
 * Draws the animated transition between two page rasters, driven 1:1 by a
 * Reanimated `progress` shared value (0..1). All per-frame work happens on the
 * UI thread: the curl shader's uniforms and the slide/fade transforms are
 * `useDerivedValue`s, which react-native-skia's reanimated recorder unwraps
 * and replays per frame — no JS-thread re-renders during a turn.
 *
 * Styles (PRD §6.3, DESIGN.md §7):
 * - curl:  cylinder-curl RuntimeEffect (CURL_SHADER_SOURCE); if
 *           `RuntimeEffect.Make` returns null the style falls back to slide
 *           (warning logged) — the reader never crashes on a bad shader.
 * - slide: outgoing page translates 30% + dims to 0.9, incoming 100%
 *           (`slideFrameAt`; easing lives inside the spec function, so the
 *           driver animates progress linearly).
 * - fade:  linear cross-fade (`fadeFrameAt`).
 * - none:  instant cut to the incoming page.
 * Reduced motion forces the 120 ms fade regardless of `style`.
 *
 * Visibility: the view is fully transparent at rest (progress ≈ 0) and fades
 * in for any progress > 0, so the coordinator can keep it mounted above the
 * static page canvas at all times.
 */

import { useMemo } from 'react';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  Canvas,
  Fill,
  Image,
  ImageShader,
  Rect,
  Shader,
  Skia,
  type SkImage,
  type SkRuntimeEffect,
  type Uniforms,
} from '@shopify/react-native-skia';

import { CURL_SHADER_SOURCE, buildCurlUniforms } from './curl';
import { slideFrameAt } from './slide';
import { fadeFrameAt } from './fade';
import type { PageAnimationStyle } from '../data/settings';

/** Placeholder color behind/between page layers (matches PageCanvas default). */
const PLACEHOLDER_COLOR = '#141416';

export interface PageTurnViewProps {
  /** Current page raster (curls / slides / fades out). Null while decoding. */
  frontImage: SkImage | null;
  /** Next/previous page raster (revealed underneath). Null while decoding. */
  backImage: SkImage | null;
  /** Turn progress 0..1, 1:1 finger-driven (gesture) or animation-driven. */
  progress: SharedValue<number>;
  /** 1 = forward (next page), -1 = backward (previous page). */
  direction: SharedValue<1 | -1>;
  /** 'curl' | 'slide' | 'fade' | 'none'. */
  style: PageAnimationStyle;
  /** On-screen page size (dp == device px for the shader math here). */
  pageSize: { w: number; h: number };
  /** When true, every style renders as the 120 ms fade (DESIGN.md §7). */
  reducedMotion: boolean;
}

function PageLayer({ image, w, h }: { image: SkImage | null; w: number; h: number }) {
  if (!image) {
    return null;
  }
  return <Image image={image} x={0} y={0} width={w} height={h} fit="contain" />;
}

export function PageTurnView({
  frontImage,
  backImage,
  progress,
  direction,
  style,
  pageSize,
  reducedMotion,
}: PageTurnViewProps) {
  const { w, h } = pageSize;

  // Compile once. Null => fall back to slide (S2 standing decision).
  const curlEffect = useMemo<SkRuntimeEffect | null>(() => {
    try {
      const effect = Skia.RuntimeEffect.Make(CURL_SHADER_SOURCE);
      if (!effect) {
        console.warn(
          '[PageTurnView] curl RuntimeEffect failed to compile; falling back to slide',
        );
      }
      return effect;
    } catch (err) {
      console.warn('[PageTurnView] curl RuntimeEffect threw; falling back to slide', err);
      return null;
    }
  }, []);

  const effectiveStyle: PageAnimationStyle =
    reducedMotion || style === 'fade'
      ? 'fade'
      : style === 'curl' && curlEffect === null
        ? 'slide'
        : style;

  const curlDir = useDerivedValue(
    () => (direction.value === 1 ? 'forward' : 'backward'),
    [direction],
  );

  // --- curl: animated uniforms (unwrapped per frame by skia's recorder) ---
  const curlUniforms = useDerivedValue<Uniforms>(
    () =>
      buildCurlUniforms({
        width: w,
        height: h,
        progress: progress.value,
        direction: curlDir.value,
      }),
    [progress, curlDir],
  );

  // --- slide: per-frame transforms from the spec functions ---
  const slideOutTransform = useDerivedValue(
    () => [
      {
        translateX: slideFrameAt(progress.value, w, curlDir.value).outgoingX,
      },
    ],
    [progress, curlDir],
  );
  const slideOutDim = useDerivedValue(
    () => slideFrameAt(progress.value, w, curlDir.value).outgoingDim,
    [progress, curlDir],
  );
  const slideInTransform = useDerivedValue(
    () => [
      {
        translateX: slideFrameAt(progress.value, w, curlDir.value).incomingX,
      },
    ],
    [progress, curlDir],
  );

  // --- fade: linear cross-fade opacities ---
  const fadeOutOpacity = useDerivedValue(
    () => fadeFrameAt(progress.value).outgoingOpacity,
    [progress],
  );
  const fadeInOpacity = useDerivedValue(
    () => fadeFrameAt(progress.value).incomingOpacity,
    [progress],
  );

  // Invisible at rest so the static page canvas shows through.
  const wrapStyle = useAnimatedStyle(() => ({
    opacity: progress.value > 0.0005 ? 1 : 0,
  }));

  if (!(w > 0 && h > 0)) {
    return null;
  }

  return (
    <Animated.View
      style={[{ width: w, height: h }, wrapStyle]}
      pointerEvents="none"
    >
      <Canvas style={{ width: w, height: h }}>
        <Rect x={0} y={0} width={w} height={h} color={PLACEHOLDER_COLOR} />

        {effectiveStyle === 'curl' && curlEffect ? (
          <Fill>
            <Shader source={curlEffect} uniforms={curlUniforms}>
              <ImageShader
                image={frontImage}
                tx="clamp"
                ty="clamp"
                fit="contain"
                rect={{ x: 0, y: 0, width: w, height: h }}
              />
              <ImageShader
                image={backImage}
                tx="clamp"
                ty="clamp"
                fit="contain"
                rect={{ x: 0, y: 0, width: w, height: h }}
              />
            </Shader>
          </Fill>
        ) : effectiveStyle === 'slide' ? (
          <>
            {/* incoming underneath, outgoing slides away on top */}
            <Image
              image={backImage}
              x={0}
              y={0}
              width={w}
              height={h}
              fit="contain"
              transform={slideInTransform}
            />
            <Image
              image={frontImage}
              x={0}
              y={0}
              width={w}
              height={h}
              fit="contain"
              transform={slideOutTransform}
              opacity={slideOutDim}
            />
          </>
        ) : effectiveStyle === 'fade' ? (
          <>
            <Image
              image={backImage}
              x={0}
              y={0}
              width={w}
              height={h}
              fit="contain"
              opacity={fadeInOpacity}
            />
            <Image
              image={frontImage}
              x={0}
              y={0}
              width={w}
              height={h}
              fit="contain"
              opacity={fadeOutOpacity}
            />
          </>
        ) : (
          // 'none': instant cut — the settle is instant so this flashes for
          // a single frame before the caller swaps the static page.
          <PageLayer image={backImage ?? frontImage} w={w} h={h} />
        )}
      </Canvas>
    </Animated.View>
  );
}
