import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trenddrop.app',
  appName: 'TrendDrop',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    // For local development with live reload:
    // url: 'http://YOUR_LOCAL_IP:3000',
    // cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#E24455',
      showSpinner: true,
    },
    // RevenueCat In-App Purchases for iOS/Android
    // Configure in native projects via RevenueCat dashboard
  },
  // iOS specific
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
  },
  // Android specific
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: true,
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
};

export default config;