/**
 * PageCanvas.tsx — draws one rasterized page with Skia.
 *
 * The page .webp lives on disk (bookSession cache); Skia loads it from the
 * file URI via `useImage('file://' + path)`:
 *  - Android: PlatformContext.getJniStreamFromSource opens the file:// URL
 *    through a URLConnection stream.
 *  - iOS: RNSkApplePlatformContext loads it via NSData dataWithContentsOfURL:.
 * Both were verified in node_modules/@shopify/react-native-skia (2.14.0).
 *
 * While the image decodes (or when `path` is null) a subtle placeholder rect
 * paints the page area so the reader never flashes white.
 */

import { useEffect, useMemo } from 'react';
import {
  Canvas,
  Image as SkiaImage,
  Rect,
  Skia,
  useImage,
  type SkPaint,
} from '@shopify/react-native-skia';
import { useSharedValue, withTiming } from 'react-native-reanimated';

interface PageCanvasProps {
  /** Local file path WITHOUT the file:// prefix; null while resolving. */
  path: string | null;
  /** On-screen size in dp. */
  width: number;
  height: number;
  /** Placeholder color shown while the image decodes. */
  placeholderColor?: string;
  /** Fade-in duration on image load (M1 pager: 180ms page switch). */
  fadeMs?: number;
  /**
   * "Smart invert" (M5, DESIGN.md §3): render the page through a Skia color
   * matrix — invert luminance + hue-rotate 180° (images keep their hue),
   * then multiply by #EDEAE3 so the page is warm ink, never pure-white glare.
   * Default false = untouched page ("Original").
   */
  invert?: boolean;
}

/**
 * 4x5 color matrices (row-major). Combined smart-invert =
 * tint(#EDEAE3) × hueRotate(180°) × invert, pre-multiplied once here.
 */
function multiplyColorMatrix(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(20).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[i * 5 + k] * b[k * 5 + j];
      if (j === 4) v += a[i * 5 + 4]; // bias column
      out[i * 5 + j] = v;
    }
  }
  return out;
}

/** R' = 1 - R (etc.). */
const INVERT = [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0];

/**
 * Hue-rotate 180° (cos = -1, sin = 0 in the standard hue-rotation matrix).
 * Inversion alone swings hues 180°; this swings them back so photos keep
 * their colors while luminance stays inverted.
 */
const HUE_ROTATE_180 = [
  -0.574, 1.43, 0.144, 0, 0, 0.426, 0.43, 0.144, 0, 0, 0.426, 1.43, -0.856, 0, 0, 0, 0,
  0, 1, 0,
];

/** Multiply RGB by #EDEAE3 (0.9294, 0.9176, 0.8902) — kills pure-white glare. */
const TINT_WARM = [
  0.9294, 0, 0, 0, 0, 0, 0.9176, 0, 0, 0, 0, 0, 0.8902, 0, 0, 0, 0, 0, 1, 0,
];

/** Pre-multiplied smart-invert matrix, rounded for stability. */
const SMART_INVERT_MATRIX: number[] = multiplyColorMatrix(
  TINT_WARM,
  multiplyColorMatrix(HUE_ROTATE_180, INVERT),
).map((v) => Math.round(v * 10000) / 10000);

export function PageCanvas({
  path,
  width,
  height,
  placeholderColor = '#141416',
  fadeMs = 180,
  invert = false,
}: PageCanvasProps) {
  const image = useImage(path ? `file://${path}` : null);
  const opacity = useSharedValue(0);

  // One paint for the whole invert mode: color-filter only, so it composes
  // with the `opacity` prop (fade-in) instead of fighting it.
  const invertPaint: SkPaint | undefined = useMemo(() => {
    if (!invert) return undefined;
    const paint = Skia.Paint();
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(SMART_INVERT_MATRIX));
    return paint;
  }, [invert]);

  // New page (or new raster): restart invisible…
  useEffect(() => {
    opacity.value = 0;
  }, [path, opacity]);

  // …and fade in once Skia has decoded the image.
  useEffect(() => {
    if (image) {
      opacity.value = withTiming(1, { duration: fadeMs });
    }
  }, [image, fadeMs, opacity]);

  if (!(width > 0 && height > 0)) return null;

  return (
    <Canvas style={{ width, height }}>
      <Rect x={0} y={0} width={width} height={height} color={placeholderColor} />
      {image ? (
        <SkiaImage
          image={image}
          x={0}
          y={0}
          width={width}
          height={height}
          fit="contain"
          opacity={opacity}
          paint={invertPaint}
        />
      ) : null}
    </Canvas>
  );
}
