import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trenddrop.app',
  appName: 'TrendDrop',
  webDir: 'build',
  server: {
    // Production: Render backend for iOS and Android
    url: 'https://trend-drop.onrender.com',
    cleartext: false,
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
    CapacitorHttp: {
      enabled: true,
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