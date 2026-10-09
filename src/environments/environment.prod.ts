// GENERADO por scripts/gen-environment.mjs — no editar a mano.
// entorno: prod. Regla 18: ng serve local jamás apunta a prod por defecto.
export const environment = {
  production: true,
  entorno: 'prod' as 'dev' | 'prod',
  version: '2.46.0',
  // CI7 — canal de distribución. Default 'pwa' (Vercel + serve local). Los builds
  // nativos lo sobreescriben: build-apk→'apk', aab→'play', iOS→'appstore'. Decide
  // cómo actualiza UpdaterService y qué textos/avisos de tienda se muestran.
  canal: 'pwa' as 'play' | 'apk' | 'appstore' | 'pwa',
  appUrl: 'https://app.sgcconstructorasd.com',
  webUrl: 'https://sgcconstructorasd.com',
  supabaseUrl: 'https://jeeqhgccqefbqilntcpu.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFoZ2NjcWVmYnFpbG50Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDI4OTEsImV4cCI6MjA5ODExODg5MX0.YMJQXxZUVZUBMh2TnIAz_0XGgpWEid-JQHbIAyoFqDs',
};
