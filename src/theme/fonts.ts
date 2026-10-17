/**
 * Folio font loading — DESIGN.md §4. Bundled TTFs in `assets/fonts/`,
 * loaded via expo-font. Fully offline: no network font loading, ever.
 *
 * Families: 'InstrumentSerif' (display / titles), 'Inter' (UI text),
 * 'JetBrainsMono' (mono / meta).
 *
 * Note: Inter and JetBrains Mono ship as variable TTFs, which cover the
 * 400/500/600 weights DESIGN.md calls for (Inter) and 400/500 (JetBrains Mono).
 */

import * as Font from 'expo-font';

export const fontFamilies = {
  /** Display / titles (Instrument Serif). */
  serif: 'InstrumentSerif',
  /** UI text (Inter). */
  sans: 'Inter',
  /** Mono / meta (JetBrains Mono). */
  mono: 'JetBrainsMono',
} as const;

export type FontFamily = (typeof fontFamilies)[keyof typeof fontFamilies];

const FONT_ASSETS = {
  [fontFamilies.serif]: require('../../assets/fonts/InstrumentSerif-Regular.ttf'),
  [fontFamilies.sans]: require('../../assets/fonts/Inter-Variable.ttf'),
  [fontFamilies.mono]: require('../../assets/fonts/JetBrainsMono-Variable.ttf'),
};

/**
 * Loads all bundled fonts. Safe to call once at startup; subsequent calls are
 * no-ops because expo-font caches loaded families.
 */
export async function loadFonts(): Promise<void> {
  await Font.loadAsync(FONT_ASSETS);
}

/** True once the font families are available (expo-font keeps its own cache). */
export async function fontsLoaded(): Promise<boolean> {
  return Font.isLoaded(fontFamilies.serif) && Font.isLoaded(fontFamilies.sans) && Font.isLoaded(fontFamilies.mono);
}
