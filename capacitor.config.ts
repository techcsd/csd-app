import type { CapacitorConfig } from '@capacitor/cli';

// BU1 F2 — la config de Capacitor conoce el entorno vía SGC_ENV (lo fija
// build-apk.mjs --env). En dev el appId lleva sufijo `.dev` (instala junto al de
// prod) y el nombre es "CSD App DEV". `cap sync` escribe esta config en el proyecto
// Android antes de `assemble<Env>Release`.
const isDev = process.env.SGC_ENV === 'dev';

const config: CapacitorConfig = {
  appId: isDev ? 'com.constructorasd.csdapp.dev' : 'com.constructorasd.csdapp',
  appName: isDev ? 'CSD App DEV' : 'CSD App',
  // Angular's application builder emits the browser bundle here.
  webDir: 'dist/csd-app/browser',
  android: {
    // Field devices are often on flaky networks; allow mixed content so the
    // WebView can talk to Supabase without odd cleartext edge cases.
    allowMixedContent: true,
  },
};

export default config;
