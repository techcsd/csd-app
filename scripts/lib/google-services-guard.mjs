// DJ1 (incidente 05-nov-2026) — guarda contra el crash de hoy: un APK de PROD
// construido sin `android/app/google-services.json` (Firebase) crashea en cuanto
// intenta registrar push, en CUALQUIER teléfono, siempre — excepción nativa no
// atrapable desde JS (ver HANDOFF.md ronda DJ para el stack trace completo).
//
// El archivo es gitignored y vive solo en el checkout principal; un
// `git worktree add` nuevo NUNCA lo trae — hay que copiarlo a mano, junto con
// `.env.local` y `android/keystore.properties`. Esta guarda falla FUERTE antes
// de gastar minutos en un build de prod que de todos modos va a crashear.
//
// Dev NO necesita el archivo (PushService.init() ya tiene su propio guard para
// 'dev' — ver BU1 F2 en push.service.ts), así que esta guarda es específica de
// `--env prod`.
import { existsSync, readFileSync } from 'node:fs';

export function verificarGoogleServicesProd(entorno) {
  if (entorno !== 'prod') return;
  const ruta = 'android/app/google-services.json';
  if (!existsSync(ruta)) {
    console.error(
      `\n🔴 DJ1: falta ${ruta} — un build de PROD sin este archivo CRASHEA en cualquier` +
        ` teléfono apenas se abre (Firebase no inicializa, PushNotifications.register()` +
        ` lanza una excepción nativa fatal). Es gitignored: si este es un worktree nuevo,` +
        ` cópialo desde el checkout principal junto con .env.local y android/keystore.properties.\n`,
    );
    process.exit(1);
  }
  let texto = '';
  try { texto = readFileSync(ruta, 'utf8'); } catch { /* el existsSync de arriba ya lo valida */ }
  if (!texto.trim()) {
    console.error(`\n🔴 DJ1: ${ruta} existe pero está vacío — mismo riesgo de crash que si faltara.\n`);
    process.exit(1);
  }
  console.log(`✓ DJ1: ${ruta} presente (prod no crasheará por Firebase ausente).`);
}
