/**
 * BU1 F2 — build firmado del APK POR ENTORNO. `--env` es OBLIGATORIO (regla 18:
 * prod nunca es el destino por defecto).
 *
 *   npm run apk -- --env dev      → app-dev-release.apk  (com.constructorasd.csdapp.dev, "CSD App DEV")
 *   npm run apk -- --env prod     → app-prod-release.apk (com.constructorasd.csdapp)
 *
 * Cadena: build-env.mjs --env <env> (environment + guards + ng build [+ patch dev])
 *   → cap sync android (SGC_ENV fija el appId/nombre) → gradlew assemble<Env>Release
 *   → imprime la ruta del APK + su certificado → registra la versión en el
 *   app_versiones del ENTORNO (--register-only, Y1). NO sube al bucket (eso es apk:publish).
 *
 * Requiere (ver scripts/build-apk.md): JAVA_HOME (Android Studio JBR/JDK 21) y
 * ANDROID_HOME (auto-detectados si no están).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolverEnv } from './lib/entorno.mjs';

const isWin = process.platform === 'win32';
const env = await resolverEnv(process.argv.slice(2));
const ENV = env.entorno;                 // 'dev' | 'prod'
const CAP = ENV[0].toUpperCase() + ENV.slice(1); // 'Dev' | 'Prod'

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p));
}

const JAVA_HOME =
  process.env.JAVA_HOME ||
  firstExisting(['C:/Program Files/Android/Android Studio/jbr', 'C:/Program Files/Android/Android Studio1/jbr']);
const ANDROID_HOME =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  firstExisting([
    `${process.env.LOCALAPPDATA || ''}/Android/Sdk`,
    `${process.env.HOME || process.env.USERPROFILE || ''}/AppData/Local/Android/Sdk`,
  ]);
if (!JAVA_HOME) { console.error('✗ JAVA_HOME not set and Android Studio JBR not found. See scripts/build-apk.md.'); process.exit(1); }
if (!ANDROID_HOME) { console.error('✗ ANDROID_HOME not set and Android SDK not found. See scripts/build-apk.md.'); process.exit(1); }

// SGC_ENV fija el entorno para capacitor.config.ts (appId/nombre) y build-env.mjs.
const procEnv = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, SGC_ENV: ENV };

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: procEnv, shell: isWin, ...opts });
  if (res.status !== 0) { console.error(`✗ command failed (${res.status}): ${cmd} ${args.join(' ')}`); process.exit(res.status || 1); }
}

// environment + guards + ng build (+ patch dev del dist). build-env corre el prebuild.
run('node', ['scripts/build-env.mjs', '--env', ENV]);
run('npx', ['cap', 'sync', 'android']);

// cmd.exe no busca en el cwd — prefijo .\ para el launcher batch en android/.
const gradlew = isWin ? '.\\gradlew.bat' : './gradlew';
run(gradlew, [`assemble${CAP}Release`, '--no-daemon'], { cwd: 'android' });

const apk = `android/app/build/outputs/apk/${ENV}/release/app-${ENV}-release.apk`;
if (!existsSync(apk)) { console.error(`✗ no se encontró el APK esperado: ${apk}`); process.exit(1); }
console.log(`\n✓ Signed APK (${ENV}): ${apk}`);

// Imprime el certificado de firma (misma keystore que prod para instalar/actualizar).
const apksigner = firstExisting(['36.0.0', '35.0.0', '34.0.0'].map((v) => `${ANDROID_HOME}/build-tools/${v}/apksigner.bat`));
if (apksigner) run(apksigner, ['verify', '--print-certs', apk]);
else console.log('(apksigner not auto-found; verify manually per scripts/build-apk.md)');

// Y1 — registrar SIEMPRE la versión al generar el APK, en el app_versiones del
// ENTORNO. --register-only no sube nada ni toca publicada/minima. Falla (exit 1) si
// no pudo registrar → ninguna versión se escapa del historial.
// --yes: la confirmación de prod ya se dio al inicio de build-apk (resolverEnv);
// no re-preguntar en el registro interno.
run('node', ['scripts/release-apk.mjs', '--env', ENV, '--register-only', '--yes']);

console.log(`\nNext (opcional): npm run apk:publish -- --env ${ENV}   # sube el APK al bucket del entorno`);
