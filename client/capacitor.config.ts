import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.trenddrop.app',
  appName: 'TrendDrop',
  webDir: 'build',
  server: {
    androidScheme: 'https',
    // For local development with live reload, uncomment the following:
    // url: 'http://YOUR_LOCAL_IP:3000',
    // cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#E24455',
      showSpinner: true,
    },
  },
};

export default config;
