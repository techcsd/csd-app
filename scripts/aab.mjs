/**
 * CI8 — build del AAB firmado para Google Play (canal `play`). `--env` OBLIGATORIO
 * (regla 18). El AAB NO se sube a ningún lado: lo sube 👤 Xaviel a Play Console.
 *
 *   npm run aab -- --env dev      → AAB dev de prueba (bundleDevPlayRelease)
 *   npm run aab -- --env prod     → AAB de Play (bundleProdPlayRelease)
 *
 * Cadena: build-env.mjs --env <env> --canal play (environment + guards + ng build)
 *   → cap sync android → gradlew bundle<Env>PlayRelease → copia a dist-store/
 *   → resumen (versionCode, tamaño, permisos del manifest fusionado del flavor play)
 *   → registra la versión en app_versiones del ENTORNO (regla Y1, igual que el APK).
 *
 * Mismo applicationId y MISMA llave que el canal apk (csd-release.keystore) → Play
 * App Signing puede recibir esa llave con PEPK y las instalaciones por APK existentes
 * actualizan desde Play sin desinstalar (ver docs/TIENDAS.md).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { resolverEnv } from './lib/entorno.mjs';
import { writeCanalGenerated, verificarCanalEnZip } from './lib/canal.mjs';

const isWin = process.platform === 'win32';
const env = await resolverEnv(process.argv.slice(2));
const ENV = env.entorno;                 // 'dev' | 'prod'
const CAP = ENV[0].toUpperCase() + ENV.slice(1); // 'Dev' | 'Prod'

function firstExisting(paths) { return paths.find((p) => p && existsSync(p)); }

const JAVA_HOME =
  process.env.JAVA_HOME ||
  firstExisting(['C:/Program Files/Android/Android Studio/jbr', 'C:/Program Files/Android/Android Studio1/jbr']);
const ANDROID_HOME =
  process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  firstExisting([`${process.env.LOCALAPPDATA || ''}/Android/Sdk`, `${process.env.HOME || process.env.USERPROFILE || ''}/AppData/Local/Android/Sdk`]);
if (!JAVA_HOME) { console.error('✗ JAVA_HOME not set and Android Studio JBR not found. See scripts/build-apk.md.'); process.exit(1); }
if (!ANDROID_HOME) { console.error('✗ ANDROID_HOME not set and Android SDK not found. See scripts/build-apk.md.'); process.exit(1); }

const procEnv = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME, SGC_ENV: ENV };

function run(cmd, args, opts = {}) {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', env: procEnv, shell: isWin, ...opts });
  if (res.status !== 0) { console.error(`✗ command failed (${res.status}): ${cmd} ${args.join(' ')}`); process.exit(res.status || 1); }
}

const VERSION = (() => {
  const m = readFileSync('src/environments/environment.prod.ts', 'utf8').match(/version:\s*'([^']+)'/);
  if (!m) { console.error('✗ no pude leer la versión de environment.prod.ts'); process.exit(1); }
  return m[1];
})();

// CL4 — canal.generated.ts='play' ANTES del build; build-env lo reafirma tras su
// prebuild (quien lo escribe en el bundle es build-env, justo antes de ng build).
writeCanalGenerated('play');
// environment + guards + ng build (canal play) → cap sync → bundle<Env>PlayRelease.
run('node', ['scripts/build-env.mjs', '--env', ENV, '--canal', 'play']);
run('npx', ['cap', 'sync', 'android']);

const gradlew = isWin ? '.\\gradlew.bat' : './gradlew';
run(gradlew, [`bundle${CAP}PlayRelease`, '--no-daemon'], { cwd: 'android' });

const aab = `android/app/build/outputs/bundle/${ENV}PlayRelease/app-${ENV}-play-release.aab`;
if (!existsSync(aab)) { console.error(`✗ no se encontró el AAB esperado: ${aab}`); process.exit(1); }

// CL4 — CANDADO: el AAB debe traer canal:"play" + la versión esperada. Si no, ABORTA.
try {
  await verificarCanalEnZip(aab, 'play', VERSION);
  console.log(`✓ candado: el AAB trae canal:"play" + version:"${VERSION}".`);
} catch (e) {
  console.error('\n' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}

mkdirSync('dist-store', { recursive: true });
const out = `dist-store/csd-app-${VERSION}${ENV === 'dev' ? '-dev' : ''}-play.aab`;
copyFileSync(aab, out);

// ── Resumen ───────────────────────────────────────────────────────────────────
const sizeMB = (statSync(out).size / (1024 * 1024)).toFixed(2);
const codeFromVersion = (v) => { const [a = 0, b = 0, c = 0] = v.split('.').map((n) => Number(n) || 0); return a * 1000000 + b * 1000 + c; };

// Permisos del manifest fusionado del flavor play (para los formularios de Play).
let permisos = [];
try {
  const mergedDir = `android/app/build/intermediates/merged_manifests/${ENV}PlayRelease`;
  const mf = firstExisting([`${mergedDir}/AndroidManifest.xml`, ...(existsSync(mergedDir) ? readdirSync(mergedDir).map((f) => `${mergedDir}/${f}`) : [])]);
  if (mf) {
    const xml = readFileSync(mf, 'utf8');
    permisos = [...xml.matchAll(/uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]).sort();
  }
} catch { /* resumen best-effort */ }

console.log('\n' + '─'.repeat(60));
console.log(`✓ AAB de Play (${ENV}, canal play): ${out}`);
console.log(`  versión:      ${VERSION}`);
console.log(`  versionCode:  ${codeFromVersion(VERSION)}`);
console.log(`  tamaño:       ${sizeMB} MB`);
console.log(`  permisos (${permisos.length}) del manifest fusionado (flavor play):`);
for (const p of permisos) console.log(`    · ${p}`);
console.log('─'.repeat(60));
console.log('\n⚠️  El AAB NO se sube automáticamente. 👤 Xaviel lo sube a Play Console.');
console.log('    Firma / Play App Signing (PEPK): ver docs/TIENDAS.md.');

// Y1 — registrar la versión en el app_versiones del ENTORNO (igual que el APK).
run('node', ['scripts/release-apk.mjs', '--env', ENV, '--register-only', '--yes']);
