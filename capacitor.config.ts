import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.constructorasd.csdapp',
  appName: 'CSD App',
  // Angular's application builder emits the browser bundle here.
  webDir: 'dist/csd-app/browser',
  android: {
    // Field devices are often on flaky networks; allow mixed content so the
    // WebView can talk to Supabase without odd cleartext edge cases.
    allowMixedContent: true,
  },
};

export default config;
