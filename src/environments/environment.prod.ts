// GENERADO por scripts/gen-environment.mjs — no editar a mano.
// entorno: prod. Regla 18: ng serve local jamás apunta a prod por defecto.
import { CANAL_BUILD } from './canal.generated';
export const environment = {
  production: true,
  entorno: 'prod' as 'dev' | 'prod',
  version: '2.46.0',
  // CI7/CL4 — canal de distribución desde canal.generated.ts. Ese archivo NO está en
  // fileReplacements de angular.json, por eso su valor SOBREVIVE al reemplazo
  // environment.ts→environment.prod.ts (el regex anterior se perdía → todo APK salía
  // 'pwa'). Default 'pwa' (Vercel/serve); nativos lo escriben apk/play/appstore.
  canal: CANAL_BUILD,
  appUrl: 'https://app.sgcconstructorasd.com',
  webUrl: 'https://sgcconstructorasd.com',
  supabaseUrl: 'https://jeeqhgccqefbqilntcpu.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImplZXFoZ2NjcWVmYnFpbG50Y3B1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDI4OTEsImV4cCI6MjA5ODExODg5MX0.YMJQXxZUVZUBMh2TnIAz_0XGgpWEid-JQHbIAyoFqDs',
};
