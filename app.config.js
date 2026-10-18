/**
 * Folio — app config. CNG: android/ and ios/ are gitignored and regenerated
 * by `expo prebuild`. No EAS, no Expo Go.
 *
 * Versioning: versionCode = GITHUB_RUN_NUMBER (Play-safe monotonic int),
 * versionName = FOLIO_VERSION_NAME (tag like v2.0.0-m0, or build-<run>).
 */
const runNumber = parseInt(process.env.GITHUB_RUN_NUMBER || '1', 10);
const versionName = process.env.FOLIO_VERSION_NAME || '2.0.0-m0-dev';

module.exports = {
  name: 'Folio',
  slug: 'folio',
  version: versionName,
  orientation: 'default',
  icon: './assets/icon.png',
  scheme: 'folio',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#0E0E10',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.yuvrajmishra.folio',
    buildNumber: String(runNumber),
  },
  android: {
    package: 'com.yuvrajmishra.folio',
    versionCode: runNumber,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0E0E10',
    },
    // No network permission, no storage permission (PRD §7.10).
    // App-private storage + SAF picker only.
    permissions: [],
  },
  plugins: ['expo-router', 'expo-font'],
  experiments: {
    typedRoutes: true,
  },
};
