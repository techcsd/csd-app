/**
 * Publish the signed release APK + version.json to the public `app-releases`
 * Supabase bucket. The SGC download page and the app's update check read these.
 *
 * Prereq: android/app/build/outputs/apk/release/app-release.apk exists
 * (see scripts/build-apk.md). Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * from .env.local.
 *
 * Usage: node scripts/release-apk.mjs
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
const VERSION = '1.5.0';
const VERSION_CODE = 18;
const CHANGELOG = 'Inspección de pre-uso de 10 tópicos oficiales; foto del vehículo al elegirlo; reporte semanal más claro. Bitácora: describa cada restricción, y el detalle muestra clima, migración y cantidades. Rutas: elige origen y destino en un mapa (buscar dirección, tu ubicación actual, o una obra/almacén del sistema).';
const RELEASED_AT = '2026-07-15';

const APK_PATH = 'android/app/build/outputs/apk/release/app-release.apk';
const bucket = 'app-releases';

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

const apk = readFileSync(APK_PATH);
const versionedName = `csd-app-${VERSION}.apk`;
const publicUrl = `${URL}/storage/v1/object/public/${bucket}/${versionedName}`;

await upload(versionedName, apk, 'application/vnd.android.package-archive');
await upload('csd-app-latest.apk', apk, 'application/vnd.android.package-archive');

const versionJson = {
  versionName: VERSION,
  versionCode: VERSION_CODE,
  min_version: VERSION,
  url: publicUrl,
  changelog: CHANGELOG,
  released_at: RELEASED_AT,
  size_bytes: apk.length,
};
await upload('version.json', JSON.stringify(versionJson, null, 2), 'application/json');

console.log('\nAPK download URL:\n  ' + publicUrl);
console.log('version.json:\n  ' + `${URL}/storage/v1/object/public/${bucket}/version.json`);
