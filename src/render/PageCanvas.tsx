/**
 * PageCanvas — the single Skia canvas that draws a page (spike S2).
 * Layers: page bitmap → theme color-matrix (M5) → annotations (M4) →
 * ruler (M3). One canvas, one draw pass (PRD §7.3).
 */
import React from 'react';
import { Canvas, Image, SkImage } from '@shopify/react-native-skia';

interface PageCanvasProps {
  image: SkImage | null;
  width: number;
  height: number;
  /** Overlay layers (annotations, ruler) drawn above the page. */
  children?: React.ReactNode;
  label?: string;
}

export function PageCanvas({ image, width, height, children, label }: PageCanvasProps): React.JSX.Element {
  return (
    <Canvas
      style={{ width, height }}
      accessibilityLabel={label ?? 'Page'}
    >
      {image ? (
        <Image image={image} x={0} y={0} width={width} height={height} fit="contain" />
      ) : null}
      {children}
    </Canvas>
  );
}
