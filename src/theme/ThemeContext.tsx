/**
 * ThemeProvider — Dark (default) / OLED / Sepia / Paper (DESIGN §3.1).
 * Dark is the baseline, not an inverted light. Each theme is hand-tuned.
 * Persists the choice via the settings repository (falls back to in-memory
 * until the DB is ready). Respects system dark mode on first launch only
 * (PRD §6.8).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import { defaultTheme, themes, ThemeColors, ThemeName } from './tokens';

interface ThemeContextValue {
  name: ThemeName;
  colors: ThemeColors;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  name: defaultTheme,
  colors: themes[defaultTheme],
  setTheme: () => {},
});

const SETTING_KEY = 'ui.theme';
let memoryTheme: ThemeName = defaultTheme;
let dbBacked = false;

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

interface Props {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: Props): React.JSX.Element {
  const system = useColorScheme();
  const [name, setName] = useState<ThemeName>(memoryTheme);

  // First launch only: seed from system appearance (PRD §6.8).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Lazy-load to avoid a hard dependency cycle at module scope.
        const { getSetting, setSetting } = await import('../data/settings');
        dbBacked = true;
        const stored = await getSetting<ThemeName>(SETTING_KEY);
        if (cancelled) return;
        if (stored && themes[stored]) {
          memoryTheme = stored;
          setName(stored);
        } else if (system === 'light') {
          // System light on first launch → Paper (never a glare-white default).
          memoryTheme = 'paper';
          setName('paper');
          await setSetting(SETTING_KEY, 'paper');
        }
      } catch {
        /* DB not ready yet — stay in-memory. */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    memoryTheme = t;
    setName(t);
    if (dbBacked) {
      import('../data/settings')
        .then(({ setSetting }) => setSetting(SETTING_KEY, t))
        .catch(() => {});
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ name, colors: themes[name], setTheme }),
    [name, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
