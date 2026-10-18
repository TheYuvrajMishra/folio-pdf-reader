import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { ErrorBoundary } from '../src/ui/ErrorBoundary';
import { SnackbarProvider } from '../src/ui/Snackbar';
import { ToastProvider } from '../src/ui/Toast';

function ThemedStatusBar(): React.JSX.Element {
  const { name } = useTheme();
  const light = name === 'dark' || name === 'oled';
  return <StatusBar style={light ? 'light' : 'dark'} />;
}

export default function RootLayout(): React.JSX.Element {
  // Inter only, bundled in assets/fonts — no network fonts (DESIGN §3.3).
  const [fontsLoaded] = useFonts({
    Inter_400Regular: require('../assets/fonts/Inter_400Regular.ttf'),
    Inter_500Medium: require('../assets/fonts/Inter_500Medium.ttf'),
    Inter_600SemiBold: require('../assets/fonts/Inter_600SemiBold.ttf'),
  });

  if (!fontsLoaded) {
    // Render nothing until the typeface is ready — no FOUT, no fallback font.
    return <View style={{ flex: 1, backgroundColor: '#0E0E10' }} />;
  }

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <ToastProvider>
              <SnackbarProvider>
                <ThemedStatusBar />
                <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
              </SnackbarProvider>
            </ToastProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
