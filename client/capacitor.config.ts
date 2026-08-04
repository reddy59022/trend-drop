import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trenddrop.app',
  appName: 'TrendDrop',
  webDir: 'build',
  server: {
    // Load bundled local assets (build/) instead of a remote URL so the app
    // starts instantly and works offline. API calls are routed by
    // client/src/services/api.js which points to the deployed backend in
    // release builds.
    cleartext: true,
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#E24455',
      showSpinner: true,
    },
    CapacitorCookies: {
      enabled: true,
    },
    // CapacitorHttp is DISABLED on purpose: axios (client/src/services/api.js)
    // handles auth tokens via request interceptors and does 401 redirects via
    // response interceptors. Enabling it would bypass those interceptors and
    // break auth on iOS and Android.
    CapacitorHttp: {
      enabled: false,
    },
    Camera: {
      permissions: ['camera', 'photos'],
    },
    Photos: {
      permissions: ['photos'],
    },
    Microphone: {
      permissions: ['microphone'],
    },
    Share: {
      enabled: true,
    },
    LocalNotifications: {
      permissions: {
        alert: true,
        badge: true,
        sound: true,
      },
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Haptics: {
      enabled: true,
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#E24455',
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
    preferredContentMode: 'mobile',
  },
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