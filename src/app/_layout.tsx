/**
 * Folio root layout (expo-router). Loads bundled fonts, holds the splash
 * screen until they are ready, and paints the dark root background (#0B0B0C).
 */

import { Slot } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadFonts } from '../theme/fonts';
import { themes } from '../theme/tokens';

// Keep the splash visible while fonts load.
void SplashScreen.preventAutoHideAsync();

const DARK_BG = themes.dark.bg;

export default function RootLayout() {
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadFonts();
      } catch (err) {
        // Never brick the boot on a font problem — fall back to system fonts.
        console.warn('[folio] font load failed, using system fonts', err);
      } finally {
        if (!cancelled) {
          setFontsReady(true);
          await SplashScreen.hideAsync().catch(() => undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>{fontsReady ? <Slot /> : null}</View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
});
