/**
 * themeStore.ts — the app-wide theme state (M5, PRD §6.8, DESIGN.md §3).
 *
 * `useTheme()` is the single zustand store every themed screen reads:
 * `const { colors, name, setTheme } = useTheme()`.
 *
 * - Persisted in the `settings` table under key `theme` (JSON).
 * - Default: `dark`. On FIRST launch only (no saved row), the system color
 *   scheme is respected: light → `paper`, dark/unknown → `dark`.
 * - `invertPdf` drives the Skia "smart invert" matrix on PageCanvas
 *   (DESIGN.md §3: invert luminance + hue-rotate 180°, then × #EDEAE3).
 * - `keepAwake` drives expo-keep-awake in the reader.
 *
 * Platform note: importing this module is safe in Node (zustand is pure JS);
 * calling `init()` / setters in Node throws via getDb() — same pattern as
 * the other data-layer modules.
 */

import { Appearance } from 'react-native';
import { create } from 'zustand';

import { getSetting, setSetting } from '../data/settings';
import { defaultTheme, themes, type ThemeColors, type ThemeName } from './tokens';

const SETTINGS_KEY = 'theme';

export interface ThemeSettings {
  name: ThemeName;
  invertPdf: boolean;
  keepAwake: boolean;
}

interface ThemeState extends ThemeSettings {
  /** Resolved token set for `name` (selector-friendly). */
  colors: ThemeColors;
  /** True once `init()` has loaded (or defaulted) the settings. */
  ready: boolean;
  /** Load persisted settings, or apply the system scheme on first launch. */
  init(): Promise<void>;
  setTheme(name: ThemeName): Promise<void>;
  /** Cycle dark → oled → sepia → paper → dark. */
  cycleTheme(): Promise<void>;
  setInvertPdf(on: boolean): Promise<void>;
  setKeepAwake(on: boolean): Promise<void>;
}

const THEME_ORDER: ThemeName[] = ['dark', 'oled', 'sepia', 'paper'];

function isThemeName(v: unknown): v is ThemeName {
  return v === 'dark' || v === 'oled' || v === 'sepia' || v === 'paper';
}

async function readSettings(): Promise<ThemeSettings | null> {
  // getSetting already swallows missing keys / corrupt JSON / DB errors.
  const parsed = await getSetting<Partial<ThemeSettings> | null>(SETTINGS_KEY, null);
  if (!parsed || !isThemeName(parsed.name)) return null;
  return {
    name: parsed.name,
    invertPdf: parsed.invertPdf === true,
    keepAwake: parsed.keepAwake !== false,
  };
}

async function writeSettings(s: ThemeSettings): Promise<void> {
  await setSetting(SETTINGS_KEY, s);
}

function firstRunDefaults(): ThemeSettings {
  // PRD §6.8: respect the system scheme on first launch only.
  const scheme = Appearance.getColorScheme();
  return {
    name: scheme === 'light' ? 'paper' : defaultTheme,
    invertPdf: false,
    keepAwake: true,
  };
}

export const useTheme = create<ThemeState>()((set, get) => ({
  name: defaultTheme,
  colors: themes[defaultTheme],
  invertPdf: false,
  keepAwake: true,
  ready: false,

  init: async () => {
    const saved = await readSettings().catch(() => null);
    const next = saved ?? firstRunDefaults();
    if (!saved) {
      // Persist the first-run choice so later launches are stable even if
      // the system scheme changes (PRD: system respected on first launch only).
      await writeSettings(next).catch(() => undefined);
    }
    set({ ...next, colors: themes[next.name], ready: true });
  },

  setTheme: async (name: ThemeName) => {
    const next: ThemeSettings = {
      name,
      invertPdf: get().invertPdf,
      keepAwake: get().keepAwake,
    };
    await writeSettings(next);
    set({ name, colors: themes[name] });
  },

  cycleTheme: async () => {
    const idx = THEME_ORDER.indexOf(get().name);
    const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    await get().setTheme(next);
  },

  setInvertPdf: async (on: boolean) => {
    const s = get();
    await writeSettings({ name: s.name, invertPdf: on, keepAwake: s.keepAwake });
    set({ invertPdf: on });
  },

  setKeepAwake: async (on: boolean) => {
    const s = get();
    await writeSettings({ name: s.name, invertPdf: s.invertPdf, keepAwake: on });
    set({ keepAwake: on });
  },
}));

/** Convenience selector: just the color tokens. */
export function useThemeColors(): ThemeColors {
  return useTheme((s) => s.colors);
}
