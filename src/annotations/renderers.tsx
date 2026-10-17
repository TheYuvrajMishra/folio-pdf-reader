/**
 * renderers.tsx — Skia overlay renderers for Folio annotations.
 *
 * `<AnnotationLayer>` draws above the page bitmap (sibling of PageCanvas
 * inside the reader's Skia Canvas). All geometry arrives in normalized page
 * coords (0..1) and is mapped to screen dp through the `toScreen` prop —
 * the caller bakes zoom/pan into it (see ANNOTATE_INTEGRATION.md).
 *
 * Accessibility (DESIGN §12): annotation types never encode meaning by
 * color alone — each type has a distinct shape:
 *  - highlight: filled rounded rect (alpha 0.35 × opacity)
 *  - rect: filled box + hairline outline (scan-friendly free box)
 *  - underline: solid 1.5 dp rule below the text
 *  - strike: 1.5 dp line through the text's vertical center
 *  - pen: freehand path, round caps
 *  - note: pin dot (outer color ring + light core)
 *  - bookmark: corner ribbon triangle at the page's top-right
 *
 * This file does drawing only; layout math lives in renderLayout.ts
 * (unit-tested). The component itself is not jest-rendered (Skia needs a
 * native runtime) — it is type-checked by tsc.
 */

import { useMemo } from 'react';
import {
  Circle,
  Line as SkiaLine,
  Path as SkiaPath,
  Rect,
  RoundedRect,
  Skia,
} from '@shopify/react-native-skia';
import { HIGHLIGHT_ALPHA } from '../theme/tokens';
import type { Annotation } from './store';
import {
  bookmarkRibbon,
  noteAnchorToScreen,
  polylineToScreen,
  rectsToScreen,
  unionScreenRect,
  type ToScreen,
} from './renderLayout';

export interface AnnotationLayerProps {
  /** Live annotations for the visible page (from store.listAnnotations). */
  annotations: Annotation[];
  /** Normalized rect → screen dp. Encodes the page rect (zoom/pan). */
  toScreen: ToScreen;
  /**
   * Per-annotation opacity override for undo/redo fade animations
   * (id → 0..1; absent = 1). Driven by the parent with Reanimated —
   * see ANNOTATE_INTEGRATION.md.
   */
  fadeById?: Record<string, number>;
}

function HighlightShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const rects = rectsToScreen(annotation, toScreen);
  const opacity = HIGHLIGHT_ALPHA * annotation.opacity * fade;
  return (
    <>
      {rects.map((r, i) => (
        <RoundedRect
          key={i}
          x={r.x0}
          y={r.y0}
          width={r.x1 - r.x0}
          height={r.y1 - r.y0}
          r={3}
          color={annotation.color}
          opacity={opacity}
          blendMode="multiply"
        />
      ))}
    </>
  );
}

function RectShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const rects = rectsToScreen(annotation, toScreen);
  const opacity = annotation.opacity * fade;
  return (
    <>
      {rects.map((r, i) => (
        <Rect
          key={i}
          x={r.x0}
          y={r.y0}
          width={r.x1 - r.x0}
          height={r.y1 - r.y0}
          color={annotation.color}
          opacity={0.18 * opacity}
          blendMode="multiply"
          style="fill"
        />
      ))}
      {rects.map((r, i) => (
        <Rect
          key={`o${i}`}
          x={r.x0}
          y={r.y0}
          width={r.x1 - r.x0}
          height={r.y1 - r.y0}
          color={annotation.color}
          opacity={0.9 * opacity}
          style="stroke"
          strokeWidth={1}
        />
      ))}
    </>
  );
}

function UnderlineShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const union = unionScreenRect(rectsToScreen(annotation, toScreen));
  if (!union) return null;
  const y = union.y1 + 2; // 2 dp below the text
  return (
    <SkiaLine
      p1={{ x: union.x0, y }}
      p2={{ x: union.x1, y }}
      color={annotation.color}
      opacity={annotation.opacity * fade}
      strokeWidth={1.5}
      strokeCap="round"
    />
  );
}

function StrikeShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const union = unionScreenRect(rectsToScreen(annotation, toScreen));
  if (!union) return null;
  const y = (union.y0 + union.y1) / 2; // through the text
  return (
    <SkiaLine
      p1={{ x: union.x0, y }}
      p2={{ x: union.x1, y }}
      color={annotation.color}
      opacity={annotation.opacity * fade}
      strokeWidth={1.5}
      strokeCap="round"
    />
  );
}

function PenShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const points = polylineToScreen(annotation, toScreen);
  const path = useMemo(() => {
    if (points.length === 0) return null;
    // Skia 2.x: mutate via SkPathBuilder, then detach() the immutable SkPath.
    const builder = Skia.PathBuilder.Make();
    builder.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      builder.lineTo(points[i].x, points[i].y);
    }
    return builder.detach();
  }, [points]);
  if (!path) return null;
  return (
    <SkiaPath
      path={path}
      color={annotation.color}
      opacity={annotation.opacity * fade}
      style="stroke"
      strokeWidth={annotation.dataJson.width ?? 3}
      strokeCap="round"
      strokeJoin="round"
    />
  );
}

function NoteShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  const anchor = noteAnchorToScreen(annotation, toScreen);
  if (!anchor) return null;
  const opacity = annotation.opacity * fade;
  return (
    <>
      <Circle
        cx={anchor.x}
        cy={anchor.y}
        r={7}
        color={annotation.color}
        opacity={opacity}
      />
      <Circle cx={anchor.x} cy={anchor.y} r={2.5} color="#FFFFFF" opacity={opacity} />
    </>
  );
}

function BookmarkShape({
  toScreen,
  color,
  fade,
}: {
  toScreen: ToScreen;
  color: string;
  fade: number;
}) {
  const ribbon = bookmarkRibbon(toScreen);
  const path = useMemo(() => {
    if (!ribbon) return null;
    const builder = Skia.PathBuilder.Make();
    builder.moveTo(ribbon[0].x, ribbon[0].y);
    builder.lineTo(ribbon[1].x, ribbon[1].y);
    builder.lineTo(ribbon[2].x, ribbon[2].y);
    builder.close();
    return builder.detach();
  }, [ribbon]);
  if (!path) return null;
  return <SkiaPath path={path} color={color} opacity={0.95 * fade} />;
}

function AnnotationShape({
  annotation,
  toScreen,
  fade,
}: {
  annotation: Annotation;
  toScreen: ToScreen;
  fade: number;
}) {
  switch (annotation.type) {
    case 'highlight':
      return <HighlightShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'rect':
      return <RectShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'underline':
      return <UnderlineShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'strike':
      return <StrikeShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'pen':
      return <PenShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'note':
      return <NoteShape annotation={annotation} toScreen={toScreen} fade={fade} />;
    case 'bookmark':
      return <BookmarkShape toScreen={toScreen} color={annotation.color} fade={fade} />;
  }
}

/**
 * Draws one page's annotations. Place inside the reader's Skia Canvas,
 * AFTER the page bitmap so annotations sit above the page.
 */
export function AnnotationLayer({
  annotations,
  toScreen,
  fadeById,
}: AnnotationLayerProps) {
  return (
    <>
      {annotations.map((a) => (
        <AnnotationShape
          key={a.id}
          annotation={a}
          toScreen={toScreen}
          fade={fadeById?.[a.id] ?? 1}
        />
      ))}
    </>
  );
}
