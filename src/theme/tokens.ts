/**
 * Folio design tokens — the single source of truth for all visual values.
 * DESIGN.md §3: every spacing/type/radius/motion/color value in the app
 * must come from here. If a value is not on these scales, it is a bug.
 */

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
export type SpacingKey = keyof typeof spacing;
/** Ordered spacing scale (DESIGN §3.2). */
export const spacingScale = [4, 8, 12, 16, 24, 32, 48] as const;

/** Screen gutter / reader chrome gutter (DESIGN §3.2). */
export const gutter = { screen: 24, readerChrome: 16 } as const;

/** Inter only, bundled in assets/fonts (DESIGN §3.3). One family per weight. */
export const fontFamilies = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
} as const;
export type FontWeightKey = keyof typeof fontFamilies;
/** Resolve a type-role weight to its bundled Inter family. */
export function fontFamilyFor(weight: FontWeightKey): string {
  return fontFamilies[weight];
}

export interface TypeRole {
  size: number;
  weight: '400' | '500' | '600';
  letterSpacing: number; // em units
  lineHeight: number; // multiplier
  tabular?: boolean;
}

/** Four type sizes only (DESIGN §3.3). Hierarchy through weight. */
export const type: Record<'title' | 'heading' | 'body' | 'caption', TypeRole> = {
  title: { size: 28, weight: '600', letterSpacing: -0.02, lineHeight: 1.2 },
  heading: { size: 20, weight: '600', letterSpacing: 0, lineHeight: 1.4 },
  body: { size: 15, weight: '400', letterSpacing: 0, lineHeight: 1.4 },
  caption: { size: 12, weight: '500', letterSpacing: 0, lineHeight: 1.4, tabular: true },
};

export interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  ink: string;
  inkMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
}

export type ThemeName = 'dark' | 'oled' | 'sepia' | 'paper';

/** Hand-tuned palettes (DESIGN §3.1). Dark is the baseline. */
export const themes: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: '#0E0E10',
    surface: '#171719',
    border: '#2A2A2E',
    ink: '#F1EEE7',
    inkMuted: '#9A968E',
    accent: '#FF6A45',
    onAccent: '#1A0A05',
    danger: '#FF5A5A',
  },
  oled: {
    bg: '#000000',
    surface: '#0B0B0C',
    border: '#1C1C1F',
    ink: '#F1EEE7',
    inkMuted: '#8A867F',
    accent: '#FF6A45',
    onAccent: '#1A0A05',
    danger: '#FF5A5A',
  },
  sepia: {
    bg: '#F1E7D3',
    surface: '#E9DDC5',
    border: '#CDBE9F',
    ink: '#211A10',
    inkMuted: '#6E6150',
    accent: '#C4481F',
    onAccent: '#FFFFFF',
    danger: '#B3261E',
  },
  paper: {
    bg: '#F7F5F0',
    surface: '#FFFFFF',
    border: '#E4E0D6',
    ink: '#161616',
    inkMuted: '#6B6963',
    accent: '#C9461D',
    onAccent: '#FFFFFF',
    danger: '#B3261E',
  },
};

export const themeNames: ThemeName[] = ['dark', 'oled', 'sepia', 'paper'];
export const defaultTheme: ThemeName = 'dark';

/**
 * Highlight colors are CONTENT, not chrome (DESIGN §3.1) — the only extra
 * hues allowed, alpha 0.35, multiply blend on light themes.
 */
export const highlightColors = {
  yellow: '#FFD60A',
  green: '#6EE7A0',
  blue: '#6CB6FF',
  pink: '#FF8FB1',
} as const;
export const highlightAlpha = 0.35;

/** Ruler defaults (DESIGN §3.1). */
export const rulerDefaults = {
  fillAlpha: 0.16,
  edgeAlpha: 0.55,
  spotlightDimAlpha: 0.75,
} as const;

/** One radius (DESIGN §3.4). 999 reserved for circular icon buttons / ruler pill. */
export const radius = { base: 14, round: 999 } as const;

/** Icon spec: lucide only, stroke 1.75 (DESIGN §3.4). */
export const icon = { strokeWidth: 1.75, size: 22, sizeDense: 20 } as const;

/** Minimum touch target (DESIGN §3.4); ruler step buttons are larger. */
export const touchTarget = { min: 48, rulerButton: 56 } as const;

/** Button spec (DESIGN §3.4): primary height 48, radius 14. */
export const button = { height: 48, radius: 14 } as const;

export const easeOut = 'cubic-bezier(0.22, 1, 0.36, 1)' as const;
/** Bezier control points of the shared ease for Reanimated's Easing.bezier(). */
export const easeOutBezier = [0.22, 1, 0.36, 1] as const;

/** Motion tokens in ms (DESIGN §3.5). Nothing animates slower than `slow`. */
export const motion = {
  fast: 150,
  base: 220,
  slow: 300,
  pressIn: 90,
  pressOut: 150,
  reduced: 120,
} as const;

/** Press spec: scale 0.97 (DESIGN §3.5 / §5). */
export const pressScale = 0.97;

/** Sheet spec (DESIGN §5). */
export const sheet = {
  slideUpMs: 260,
  scrimAlpha: 0.4,
  shadow: { offsetY: 8, blur: 24, alpha: 0.18 },
} as const;
