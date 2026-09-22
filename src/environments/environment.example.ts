// PLANTILLA versionada (referencia). NO se usa en runtime. `environment.ts` es
// gitignored y se genera con `npm run env:dev` / `npm run env:prod`
// (scripts/gen-environment.mjs, lee SUPABASE_URL_<ENV>/SUPABASE_ANON_KEY_<ENV> de
// .env.local). Con supabaseUrl vacío la app arranca en la pantalla fija
// "Sin proyecto configurado — corre `npm run env:dev`" (regla 18: ng serve local
// nunca habla con prod por defecto). Los builds (npm run build / Vercel / APK) NO
// usan este archivo: build-env.mjs copia environment.dev.ts / environment.prod.ts.
export const environment = {
  production: false,
  entorno: 'dev' as 'dev' | 'prod',
  version: '2.26.1',
  appUrl: 'https://app-dev.sgcconstructorasd.com',
  supabaseUrl: '',
  supabaseAnonKey: '',
};
