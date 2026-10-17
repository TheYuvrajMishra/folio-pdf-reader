/**
 * Folio design tokens — DESIGN.md §3 (color), §4 (typography), §5 (layout).
 * Dark is the default and the design baseline.
 */

export type ThemeName = 'dark' | 'oled' | 'sepia' | 'paper';

export interface ThemeColors {
  /** App background. */
  bg: string;
  /** Raised surface (sheets, cards, floating controls). */
  surface: string;
  /** Primary text / warm ink. */
  ink: string;
  /** Secondary text. */
  inkMuted: string;
  /** 1 px hairline rules. */
  rule: string;
  /** Ember accent — "you are here / active tool". */
  accent: string;
  /** Destructive actions. */
  danger: string;
}

export const themes: Record<ThemeName, ThemeColors> = {
  dark: {
    bg: '#0B0B0C',
    surface: '#141416',
    ink: '#EDEAE3',
    inkMuted: '#8C8981',
    rule: '#26262A',
    accent: '#FF5A36',
    danger: '#FF4D4D',
  },
  oled: {
    bg: '#000000',
    surface: '#0A0A0A',
    ink: '#EDEAE3',
    inkMuted: '#7F7C75',
    rule: '#1A1A1C',
    accent: '#FF5A36',
    danger: '#FF4D4D',
  },
  sepia: {
    bg: '#F1E7D3',
    surface: '#E8DCC3',
    ink: '#2A2218',
    inkMuted: '#6E6150',
    rule: '#CDBE9F',
    accent: '#C8431F',
    danger: '#B3261E',
  },
  paper: {
    bg: '#F6F4EE',
    surface: '#ECE9E1',
    ink: '#141414',
    inkMuted: '#6B6963',
    rule: '#D6D2C6',
    accent: '#D9441E',
    danger: '#B3261E',
  },
};

export const defaultTheme: ThemeName = 'dark';

/** Annotation highlight palette — alpha 0.35 over the page (multiply blend on light themes). */
export const highlightPalette = {
  yellow: '#FFD60A',
  green: '#6EE7A0',
  blue: '#6CB6FF',
  pink: '#FF8FB1',
  orange: '#FFA657',
} as const;

export type HighlightColorName = keyof typeof highlightPalette;

export const HIGHLIGHT_ALPHA = 0.35;

/** Ruler defaults — DESIGN.md §3. */
export const rulerTokens = {
  /** Amber band. */
  bandFill: '#FFB020',
  bandFillAlpha: 0.22,
  bandRuleAlpha: 0.6,
  /** Spotlight style: dim the rest of the page with `bg` at this alpha. */
  spotlightDimAlpha: 0.75,
} as const;

/** Spacing — 4 pt grid (DESIGN.md §5). Screen gutter 20, reader chrome gutter 16. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  gutter: 20,
  readerGutter: 16,
} as const;

/** Shape — editorial, sharp surfaces; floating controls fully round. */
export const radii = {
  surface: 2,
  floating: 999,
} as const;

/** Type scale in sp — DESIGN.md §4. UI line-height 1.4, titles 1.1. */
export const typeScale = {
  caption: 11,
  small: 13,
  body: 15,
  title3: 17,
  title2: 22,
  title1: 28,
  display: 40,
} as const;

export const lineHeight = {
  ui: 1.4,
  title: 1.1,
} as const;

/** Mono meta (page numbers, percentages, line indices) gets +0.4 letter spacing. */
export const monoLetterSpacing = 0.4;
