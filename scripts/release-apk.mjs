/**
 * Publish the signed release APK + version.json to the public `app-releases`
 * Supabase bucket, AND register the version in `sgc.app_versiones` so the SGC
 * web "Historial de versiones" / "Versiones de la app" stay up to date on their
 * own (no manual entry). The register step is idempotent and never touches the
 * publicada/minima flags of an existing row (the admin controls those in SGC).
 *
 * Prereq: android/app/build/outputs/apk/release/app-release.apk exists
 * (see scripts/build-apk.md). Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from .env.local.
 *
 * Usage:
 *   node scripts/release-apk.mjs                 # sube el APK al bucket + registra en el historial
 *   node scripts/release-apk.mjs --register-only # SOLO registra en el historial (no sube nada, no publica)
 */
import { readFileSync } from 'node:fs';

function loadEnvLocal() {
  const env = {};
  try {
    for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
    }
  } catch {
    /* ignore */
  }
  return env;
}

const env = loadEnvLocal();
const URL = env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

// Keep in sync with src/environments + android versionName.
const VERSION = '1.6.0';
// V5: versionCode is DERIVED from the version (major*1e6 + minor*1e3 + patch),
// matching android/app/build.gradle and the backend version_code scheme.
const codeFromVersion = (v) => {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map((n) => Number(n) || 0);
  return maj * 1000000 + min * 1000 + pat;
};
const VERSION_CODE = codeFromVersion(VERSION);
// Rollout escalonado (R15): 1.5.0 queda DISPONIBLE para descargar, pero NO se
// fuerza. El mínimo se mantiene en 1.4.0 (no forzamos a los de campo); subir el
// forzado se hace conscientemente desde SGC → app-versiones o cambiando esto.
const MIN_VERSION = '1.4.0';
const TITULO = 'Actualización desde la app, catálogo oficial y requisición por hojas';
// Cambios etiquetados (nuevo|mejora|arreglo|seguridad) — alimentan el timeline
// del historial (cambios) y, unidos, las notas / el changelog de version.json.
const CAMBIOS = [
  { t: 'nuevo', d: 'Actualízate desde la misma app: cuando hay una versión nueva, un botón la descarga e instala sin ir a la página web.' },
  { t: 'nuevo', d: 'Catálogo oficial de materiales (8 categorías). Al pedir EPP se indica la talla; "Otros" permite describir lo que no está en la lista.' },
  { t: 'nuevo', d: 'Requisición rediseñada por hojas, igual que salida/entrada, con resumen y compartir por WhatsApp.' },
  { t: 'mejora', d: 'Reporte semanal para cualquier conductor: elige un vehículo del pool aunque no tengas uno asignado.' },
  { t: 'mejora', d: 'Tarjetas de vehículos con foto, tipo y kilometraje en todos los listados.' },
  { t: 'mejora', d: 'Conteo: si todo está conforme, puedes guardar sin diferencias.' },
  { t: 'mejora', d: 'Pantallas de carga (skeletons) en toda la app — nunca una pantalla en blanco.' },
  { t: 'arreglo', d: 'El botón "Siguiente" siempre visible en salida de material y al asignarte un vehículo.' },
  { t: 'arreglo', d: '"Verificar versión" ahora detecta correctamente cuando hay una nueva publicada.' },
];
const CHANGELOG = CAMBIOS.map((c) => c.d).join(' ');
const RELEASED_AT = '2026-07-15';

const APK_PATH = 'android/app/build/outputs/apk/release/app-release.apk';
const bucket = 'app-releases';
const registerOnly = process.argv.includes('--register-only');
const versionedName = `csd-app-${VERSION}.apk`;
const publicUrl = `${URL}/storage/v1/object/public/${bucket}/${versionedName}`;

async function upload(objectName, body, contentType) {
  const res = await fetch(`${URL}/storage/v1/object/${bucket}/${objectName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KEY}`,
      apikey: KEY,
      'Content-Type': contentType,
      'x-upsert': 'true',
      'cache-control': '3600',
    },
    body,
  });
  if (!res.ok) throw new Error(`upload ${objectName}: ${res.status} ${await res.text()}`);
  console.log(`✓ uploaded ${objectName}`);
}

/**
 * Registra (o actualiza) la versión en sgc.app_versiones para que el historial
 * y la página de versiones de SGC estén siempre al día sin captura manual.
 * Idempotente: si la fila ya existe, actualiza fecha/título/cambios/notas/apk_url
 * pero NO toca publicada/minima (esas las controla el admin en SGC).
 */
async function registrarEnHistorial() {
  const base = URL.replace(/\/$/, '');
  const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const datos = {
    fecha: RELEASED_AT,
    titulo: TITULO,
    cambios: CAMBIOS,
    notas: CHANGELOG,
    apk_url: publicUrl,
  };

  const getRes = await fetch(
    `${base}/rest/v1/app_versiones?plataforma=eq.movil&version=eq.${encodeURIComponent(VERSION)}&select=id`,
    { headers: { ...auth, 'Accept-Profile': 'sgc' } },
  );
  if (!getRes.ok) throw new Error(`historial lookup: ${getRes.status} ${await getRes.text()}`);
  const rows = await getRes.json();

  if (Array.isArray(rows) && rows.length) {
    const res = await fetch(`${base}/rest/v1/app_versiones?id=eq.${rows[0].id}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', Prefer: 'return=minimal' },
      body: JSON.stringify(datos),
    });
    if (!res.ok) throw new Error(`historial update: ${res.status} ${await res.text()}`);
    console.log(`✓ historial actualizado (v${VERSION})`);
  } else {
    const res = await fetch(`${base}/rest/v1/app_versiones`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', Prefer: 'return=minimal' },
      body: JSON.stringify({ version: VERSION, plataforma: 'movil', publicada: false, minima: false, ...datos }),
    });
    if (!res.ok) throw new Error(`historial insert: ${res.status} ${await res.text()}`);
    console.log(`✓ registrado en el historial (v${VERSION}, borrador — no publicado)`);
  }
}

if (!registerOnly) {
  const apk = readFileSync(APK_PATH);
  await upload(versionedName, apk, 'application/vnd.android.package-archive');
  await upload('csd-app-latest.apk', apk, 'application/vnd.android.package-archive');

  const versionJson = {
    versionName: VERSION,
    versionCode: VERSION_CODE,
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
  console.log('Modo --register-only: no se sube nada al bucket (no se publica).');
}

// Mantener el historial de SGC al día siempre (ambos modos).
await registrarEnHistorial();
