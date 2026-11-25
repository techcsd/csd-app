// 2026-11-25 · EA — crea el bucket PRIVADO `app-sourcemaps` (source maps de la app, para simbolizar stacks).
// Qué investigó: los stacks de app_error_reports llegan minificados (chunk-XXXX.js:1:NNNNN) y no se pueden mapear.
// Qué hace: crea el bucket (public=false, 50 MB por archivo, solo application/json). Idempotente. Acceso SOLO con
//           service_role (sin políticas para authenticated/anon → nadie desde la app puede leerlo).
// Por qué queda: regla 19 — toda escritura en prod vive en un archivo versionado.
// Uso: node scripts/data-fixes/2026-11-25-ea-bucket-sourcemaps.mjs --env dev|prod [--yes]
import '../lib/load-env.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--env');
const env = i !== -1 ? argv[i + 1] : null;
if (env !== 'dev' && env !== 'prod') { console.error('🔴 falta --env dev|prod'); process.exit(1); }
if (env === 'prod' && !argv.includes('--yes')) { console.error('🔴 prod requiere --yes'); process.exit(1); }
const S = env.toUpperCase();
const url = process.env[`SUPABASE_URL_${S}`];
const key = process.env[`SUPABASE_SERVICE_ROLE_KEY_${S}`];
if (!url || !key) { console.error(`🔴 faltan SUPABASE_URL_${S}/SUPABASE_SERVICE_ROLE_KEY_${S}`); process.exit(1); }

const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const body = { id: 'app-sourcemaps', name: 'app-sourcemaps', public: false, file_size_limit: 52428800, allowed_mime_types: ['application/json'] };
let r = await fetch(`${url}/storage/v1/bucket`, { method: 'POST', headers: h, body: JSON.stringify(body) });
const txt = await r.text();
if (r.ok) console.log(`✓ bucket app-sourcemaps creado (${env})`);
else if (/already exists|Duplicate/i.test(txt)) {
  r = await fetch(`${url}/storage/v1/bucket/app-sourcemaps`, { method: 'PUT', headers: h, body: JSON.stringify({ public: false, file_size_limit: body.file_size_limit, allowed_mime_types: body.allowed_mime_types }) });
  console.log(r.ok ? `✓ bucket app-sourcemaps ya existía; configuración reafirmada (${env})` : `🔴 PUT ${r.status} ${await r.text()}`);
  process.exit(r.ok ? 0 : 1);
} else { console.error(`🔴 ${r.status} ${txt}`); process.exit(1); }
