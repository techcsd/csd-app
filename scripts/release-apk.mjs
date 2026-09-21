/**
 * BU1 F2/F3 — publica el APK firmado + version.json al bucket `app-releases` DEL
 * PROYECTO DEL ENTORNO y registra la versión en SU `sgc.app_versiones` (mismo Y1).
 * `--env dev|prod` es OBLIGATORIO (regla 18: prod nunca es el destino por defecto).
 *
 *   node scripts/release-apk.mjs --env dev                 # sube al bucket de dev + registra en dev
 *   node scripts/release-apk.mjs --env prod --yes          # sube a prod + registra (exige haber salido en dev)
 *   node scripts/release-apk.mjs --env <env> --register-only  # SOLO registra (no sube, no publica)
 *
 * REGLA 18 (gate): `--env prod` consulta el app_versiones de DEV; si esa misma
 * `version` no salió en dev → RECHAZA. Excepción explícita: `--force-prod --motivo "…"`.
 *
 * Y1 (historial confiable): registra SIEMPRE con notas ESTRUCTURADAS (titulo +
 * cambios[] tipados) y FALLA (exit 1) si no pudo registrar.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolverEnv } from './lib/entorno.mjs';

const env = await resolverEnv(process.argv.slice(2));
const ENV = env.entorno; // 'dev' | 'prod'
const URL = env.url;
const KEY = env.serviceKey;
if (!URL || !KEY) {
  console.error(`✗ Faltan SUPABASE_URL_${ENV.toUpperCase()} / SUPABASE_SERVICE_ROLE_KEY_${ENV.toUpperCase()} en .env.local`);
  process.exit(1);
}

// Fuente única de la versión: environment.prod.ts (alineada con build.gradle).
const VERSION = (() => {
  const m = readFileSync('src/environments/environment.prod.ts', 'utf8').match(/version:\s*'([^']+)'/);
  if (!m) { console.error('✗ no pude leer la versión de environment.prod.ts'); process.exit(1); }
  return m[1];
})();
const codeFromVersion = (v) => { const [maj = 0, min = 0, pat = 0] = v.split('.').map((n) => Number(n) || 0); return maj * 1000000 + min * 1000 + pat; };
const VERSION_CODE = codeFromVersion(VERSION);
// Alineado con la fila `minima=true` en el app_versiones del entorno. 2.26.1 se forzó
// como mínima en prod (con OK de Xaviel).
const MIN_VERSION = '2.26.1';
const RELEASED_AT = '2026-09-21';

const TITULO = 'La app completa en inglés (sale de beta)';
const CAMBIOS_CURADOS = [
  { t: 'mejora', m: 'Ajustes', d: 'El inglés ahora cubre TODA la app: inicio, todos los hubs y sus pantallas (Registrar combustible, Conduces, Pendientes, Bitácora, Solicitudes, Inventario…). Ya no aparece "beta". Kreyòl estará disponible pronto.' },
];

const TIPO_POR_COMMIT = { feat: 'nuevo', fix: 'arreglo', perf: 'mejora', refactor: 'mejora', style: 'mejora', sec: 'seguridad', security: 'seguridad' };
function cambiosDesdeCommits() {
  let range;
  try { const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim(); range = `${tag}..HEAD`; }
  catch { range = '-30'; }
  let log = '';
  try { log = execSync(`git log ${range} --pretty=format:%s`, { encoding: 'utf8' }); } catch { return []; }
  const out = [];
  for (const line of log.split('\n')) {
    const m = line.match(/^(\w+)(?:\(.+?\))?!?:\s*(.+)$/);
    if (!m) continue;
    const t = TIPO_POR_COMMIT[m[1].toLowerCase()];
    if (!t) continue;
    out.push({ t, d: m[2].trim() });
  }
  return out;
}
const CAMBIOS = CAMBIOS_CURADOS.length ? CAMBIOS_CURADOS : cambiosDesdeCommits();
if (!CAMBIOS.length) { console.error('✗ Y1: no hay cambios tipados. Edita CAMBIOS_CURADOS o usa commits convencionales.'); process.exit(1); }
const CHANGELOG = CAMBIOS.map((c) => c.d).join(' ');

// APK del flavor del entorno.
const APK_PATH = `android/app/build/outputs/apk/${ENV}/release/app-${ENV}-release.apk`;
const bucket = 'app-releases';
const registerOnly = process.argv.includes('--register-only');
const versionedName = `csd-app-${VERSION}.apk`;
const publicUrl = `${URL}/storage/v1/object/public/${bucket}/${versionedName}`;

// ── REGLA 18: prod exige que la versión haya salido en dev ────────────────────
async function gateReglaDieciocho() {
  if (ENV !== 'prod') return; // dev no está gateado
  if (env.forceProd) {
    console.warn(`\n⚠️  --force-prod: se SALTA la regla 18 (v${VERSION} directo a prod). Motivo: ${env.motivo}\n`);
    return;
  }
  const devUrl = process.env.SUPABASE_URL_DEV;
  const devKey = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV;
  if (!devUrl || !devKey) { console.error('✗ Regla 18: faltan SUPABASE_URL_DEV / SUPABASE_SERVICE_ROLE_KEY_DEV para verificar dev.'); process.exit(1); }
  const res = await fetch(
    `${devUrl.replace(/\/$/, '')}/rest/v1/app_versiones?plataforma=eq.movil&version=eq.${encodeURIComponent(VERSION)}&select=version`,
    { headers: { apikey: devKey, Authorization: `Bearer ${devKey}`, 'Accept-Profile': 'sgc' } },
  );
  if (!res.ok) { console.error(`✗ Regla 18: no pude consultar dev (${res.status} ${await res.text()}).`); process.exit(1); }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(
      `\n🔴 REGLA 18: ${VERSION} no ha salido en dev.\n` +
        `   Primero:  npm run apk:publish -- --env dev\n` +
        `   Si de verdad debe ir directo a prod:  npm run apk:publish -- --env prod --force-prod --motivo "…"\n`,
    );
    process.exit(1);
  }
  console.log(`✓ Regla 18: v${VERSION} existe en dev — prod permitido.`);
}

async function upload(objectName, body, contentType) {
  const res = await fetch(`${URL}/storage/v1/object/${bucket}/${objectName}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, apikey: KEY, 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': '3600' },
    body,
  });
  if (!res.ok) throw new Error(`upload ${objectName}: ${res.status} ${await res.text()}`);
  console.log(`✓ uploaded ${objectName}`);
}

async function registrarEnHistorial() {
  const base = URL.replace(/\/$/, '');
  const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const res = await fetch(`${base}/rest/v1/rpc/registrar_version`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc' },
    body: JSON.stringify({ p_plataforma: 'movil', p_version: VERSION, p_notas: CHANGELOG, p_titulo: TITULO, p_cambios: CAMBIOS, p_url: registerOnly ? null : publicUrl }),
  });
  if (!res.ok) throw new Error(`registrar_version: ${res.status} ${await res.text()}`);
  console.log(`✓ historial (${ENV}) registrado vía RPC (v${VERSION})`);

  if (!registerOnly) {
    const patch = await fetch(`${base}/rest/v1/app_versiones?plataforma=eq.movil&version=eq.${encodeURIComponent(VERSION)}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', Prefer: 'return=minimal' },
      body: JSON.stringify({ apk_url: publicUrl }),
    });
    if (!patch.ok) throw new Error(`set apk_url: ${patch.status} ${await patch.text()}`);
    console.log(`✓ apk_url actualizado (${ENV}, v${VERSION})`);
  }

  // --force-prod: intento best-effort de dejar rastro en la fila (columnas opcionales).
  if (ENV === 'prod' && env.forceProd) {
    try {
      const patch = await fetch(`${base}/rest/v1/app_versiones?plataforma=eq.movil&version=eq.${encodeURIComponent(VERSION)}`, {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', Prefer: 'return=minimal' },
        body: JSON.stringify({ forzada: true, motivo: env.motivo }),
      });
      if (patch.ok) console.log('✓ fila marcada forzada/motivo (--force-prod)');
      else console.warn(`⚠️  no pude marcar forzada/motivo (columnas ausentes?): ${patch.status}. Motivo queda solo en consola: ${env.motivo}`);
    } catch (e) { console.warn(`⚠️  forzada/motivo best-effort falló: ${e}. Motivo: ${env.motivo}`); }
  }
}

// ── main ──────────────────────────────────────────────────────────────────────
await gateReglaDieciocho();

if (!registerOnly) {
  const apk = readFileSync(APK_PATH);
  await upload(versionedName, apk, 'application/vnd.android.package-archive');
  await upload('csd-app-latest.apk', apk, 'application/vnd.android.package-archive');
  const versionJson = {
    versionName: VERSION,
    versionCode: VERSION_CODE,
    entorno: ENV, // BU1 F2.4 — la app solo acepta el version.json de su propio entorno
    min_version: MIN_VERSION,
    url: publicUrl,
    changelog: CHANGELOG,
    released_at: RELEASED_AT,
    size_bytes: apk.length,
  };
  await upload('version.json', JSON.stringify(versionJson, null, 2), 'application/json');
  console.log('\nAPK download URL:\n  ' + publicUrl);
  console.log('version.json:\n  ' + `${URL}/storage/v1/object/public/${bucket}/version.json`);
} else {
  console.log(`Modo --register-only (${ENV}): no se sube nada al bucket (no se publica).`);
}

try {
  await registrarEnHistorial();
} catch (e) {
  console.error(`\n✗ RELEASE FALLÓ: no se pudo registrar la versión en el historial (${ENV}).\n  ${e instanceof Error ? e.message : e}\n  Regla Y1: ninguna versión debe quedar sin registrar. Corrige y reintenta.`);
  process.exit(1);
}
