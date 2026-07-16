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
const VERSION = '1.7.2';
// V5: versionCode is DERIVED from the version (major*1e6 + minor*1e3 + patch),
// matching android/app/build.gradle and the backend version_code scheme.
const codeFromVersion = (v) => {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map((n) => Number(n) || 0);
  return maj * 1000000 + min * 1000 + pat;
};
const VERSION_CODE = codeFromVersion(VERSION);
// Rollout escalonado (R15): el mínimo forzado se controla en SGC → app-versiones
// (sgc.app_versiones.minima → version_publicada().version_minima, que alimenta el
// gate bloqueante). 1.6.0 quedó como mínimo forzado (2026-07-15). Mantener este
// valor alineado con esa fila para que version.json (aviso) no contradiga el gate.
const MIN_VERSION = '1.6.0';
const TITULO = 'Correcciones de QA (estabilidad y detalles)';
// Cambios etiquetados (nuevo|mejora|arreglo|seguridad) — alimentan el timeline
// del historial (cambios) y, unidos, las notas / el changelog de version.json.
const CAMBIOS = [
  { t: 'arreglo', d: 'La cantidad ya no se pierde al pedir EPP con talla.' },
  { t: 'arreglo', d: 'La barra "toca para reintentar" ahora reintenta de verdad los envíos con problema.' },
  { t: 'arreglo', d: 'Kilometraje incoherente bloqueado en reporte semanal y checklist (evita envíos atascados).' },
  { t: 'arreglo', d: 'Compartir por WhatsApp ya no muestra error si cancelas.' },
  { t: 'mejora', d: 'Checklist de liberación e incidente: preguntan antes de salir para no perder lo escrito.' },
  { t: 'mejora', d: 'Más detalles legibles: fechas con hora, km con separador, estado de ruta, intentos de PIN.' },
  { t: 'mejora', d: 'Pantallas de combustible, checklist y mantenimiento muestran carga (skeleton) en vez de datos vacíos.' },
];
const CHANGELOG = CAMBIOS.map((c) => c.d).join(' ');
const RELEASED_AT = '2026-07-16';

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
 * Registra (o actualiza) la versión en sgc.app_versiones vía el RPC idempotente
 * sgc.registrar_version(plataforma, version, notas) para que el historial y la
 * página de versiones de SGC estén al día sin captura manual. El RPC hace UPSERT
 * por (plataforma, version) y NO toca publicada/minima (las controla el admin).
 */
async function registrarEnHistorial() {
  const base = URL.replace(/\/$/, '');
  const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const res = await fetch(`${base}/rest/v1/rpc/registrar_version`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc' },
    body: JSON.stringify({ p_plataforma: 'movil', p_version: VERSION, p_notas: CHANGELOG }),
  });
  if (!res.ok) throw new Error(`registrar_version: ${res.status} ${await res.text()}`);
  console.log(`✓ historial registrado vía RPC (v${VERSION})`);

  // registrar_version() no maneja apk_url; cuando subimos el APK, dejamos la URL
  // en la fila para que version_publicada().apk_url alimente la actualización
  // in-app (V3). No toca publicada/minima (eso lo controla el admin en SGC).
  if (!registerOnly) {
    const patch = await fetch(
      `${base}/rest/v1/app_versiones?plataforma=eq.movil&version=eq.${encodeURIComponent(VERSION)}`,
      {
        method: 'PATCH',
        headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc', Prefer: 'return=minimal' },
        body: JSON.stringify({ apk_url: publicUrl }),
      },
    );
    if (!patch.ok) throw new Error(`set apk_url: ${patch.status} ${await patch.text()}`);
    console.log(`✓ apk_url actualizado (v${VERSION})`);
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
