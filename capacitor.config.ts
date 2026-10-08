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
    // CI6 — allowMixedContent=false: el informe previo al lanzamiento de Play
    // marca el contenido mixto como señal de inseguridad. Todo el tráfico de la
    // app es HTTPS (Supabase, Vercel, edges); no hay ninguna URL http:// (grep=0).
    allowMixedContent: false,
  },
};

export default config;
