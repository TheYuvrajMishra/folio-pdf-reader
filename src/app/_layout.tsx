/**
 * Folio root layout (expo-router). Loads bundled fonts, holds the splash
 * screen until they are ready, and paints the dark root background (#0B0B0C).
 */

import { Slot, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EngineHost, getEngine } from '../engine/engineHost';
import { consumeIncomingPdf, onIncomingPdf } from '../library/deepLink';
import { setSharedEngine } from '../library/engineSerial';
import { loadFonts } from '../theme/fonts';
import { useTheme } from '../theme/themeStore';

// Keep the splash visible while fonts load.
void SplashScreen.preventAutoHideAsync();

/** Root background + status-bar style follow the active theme. */
function useRootChrome(): { bg: string; barStyle: 'light' | 'dark' } {
  const bg = useTheme((s) => s.colors.bg);
  const barStyle = useTheme((s) => (s.name === 'sepia' || s.name === 'paper' ? 'dark' : 'light'));
  return { bg, barStyle };
}

/**
 * Routes an incoming PDF (share sheet / VIEW intent) to the library's
 * import flow: the library screen reads the `incoming` param.
 */
function routeIncomingPdf(router: ReturnType<typeof useRouter>, uri: string): void {
  router.replace({ pathname: '/', params: { incoming: uri } });
}

/**
 * Launch hook: consume a cold-start PDF share and route it to import, and
 * subscribe for warm-start shares while the app is running.
 */
function useIncomingPdfRoute() {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    // Cold start: the URL the app was launched with, if it carries a PDF.
    consumeIncomingPdf()
      .then((uri) => {
        if (!cancelled && uri) routeIncomingPdf(router, uri);
      })
      .catch(() => undefined);
    // Warm start: a share arriving while the app is running.
    const unsubscribe = onIncomingPdf((uri) => {
      if (!cancelled) routeIncomingPdf(router, uri);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [router]);
}

export default function RootLayout() {
  const [fontsReady, setFontsReady] = useState(false);
  const { bg, barStyle } = useRootChrome();

  useIncomingPdfRoute();

  // M5: load the persisted theme (or the first-run system default) once.
  useEffect(() => {
    void useTheme.getState().init();
  }, []);

  // Register the engine singleton with the library's serialized-access slot
  // (used by background indexing) — exactly once, at boot.
  useEffect(() => {
    setSharedEngine(getEngine());
  }, []);

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
    <GestureHandlerRootView style={[styles.root, { backgroundColor: bg }]}>
      <SafeAreaProvider>
        <StatusBar style={barStyle} />
        {/* Headless PDF engine (hidden WebView) — mounted once, never unmounts. */}
        <EngineHost />
        <View style={[styles.root, { backgroundColor: bg }]}>
          {fontsReady ? <Slot /> : null}
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
