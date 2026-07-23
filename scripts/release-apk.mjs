/**
 * Publish the signed release APK + version.json to the public `app-releases`
 * Supabase bucket, AND register the version in `sgc.app_versiones` so the SGC
 * web "Historial de versiones" / "Versiones de la app" stay up to date on their
 * own (no manual entry). The register step is idempotent and never touches the
 * publicada/minima flags of an existing row (the admin controls those in SGC).
 *
 * Y1 (REGLA — historial confiable): cada release registra la versión SIEMPRE con
 * notas ESTRUCTURADAS (titulo + cambios[] tipados: nuevo|mejora|arreglo|seguridad),
 * el MISMO formato que la web, y **el release FALLA (exit 1) si no se pudo
 * registrar** — así ninguna versión se escapa sin quedar en el historial. Los
 * cambios se toman de CAMBIOS_CURADOS; si está vacío, se generan de los commits
 * (feat→nuevo, fix→arreglo, perf/refactor→mejora, sec→seguridad). Ver CLAUDE.md.
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
import { execSync } from 'node:child_process';

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
const VERSION = '1.25.2';
// V5: versionCode is DERIVED from the version (major*1e6 + minor*1e3 + patch),
// matching android/app/build.gradle and the backend version_code scheme.
const codeFromVersion = (v) => {
  const [maj = 0, min = 0, pat = 0] = v.split('.').map((n) => Number(n) || 0);
  return maj * 1000000 + min * 1000 + pat;
};
const VERSION_CODE = codeFromVersion(VERSION);
// Rollout escalonado (R15): el mínimo forzado se controla en SGC → app-versiones
// (sgc.app_versiones.minima → version_publicada().version_minima, que alimenta el
// gate bloqueante). 1.20.0 quedó como mínimo forzado (2026-07-20: fix de envíos
// atascados —backfill de capturado_en— + firmar liberación desde el aviso).
// Mantener alineado con la fila `minima=true`.
const MIN_VERSION = '1.24.0';
const RELEASED_AT = '2026-07-23';

// Título corto de la entrada del historial (opcional pero recomendado).
const TITULO = 'Historial sin registros de prueba y "Rutas que creé" más claro';
// Cambios CURADOS (copy para el usuario), etiquetados nuevo|mejora|arreglo|seguridad.
// Si se deja vacío, se generan de los commits (ver cambiosDesdeCommits()).
const CAMBIOS_CURADOS = [
  { t: 'arreglo', d: 'En "Mi actividad", el historial (reportes semanales, pre-usos, echadas y rutas creadas) ya no muestra los registros marcados como prueba.' },
  { t: 'mejora', d: '"Rutas que creé" muestra cada ruta con su detalle a la vista: origen, destino, vehículo, conductor y estado.' },
];

const TIPO_POR_COMMIT = {
  feat: 'nuevo',
  fix: 'arreglo',
  perf: 'mejora',
  refactor: 'mejora',
  style: 'mejora',
  sec: 'seguridad',
  security: 'seguridad',
};

/**
 * Y1 — genera cambios[] tipados desde los commits (convención feat/fix/…) del
 * rango desde el último tag hasta HEAD. Se usa como respaldo cuando CAMBIOS_CURADOS
 * está vacío para que NUNCA se registre una versión sin notas estructuradas.
 */
function cambiosDesdeCommits() {
  let range;
  try {
    const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
    range = `${tag}..HEAD`;
  } catch {
    range = '-30'; // sin tags: últimos 30 commits
  }
  let log = '';
  try {
    log = execSync(`git log ${range} --pretty=format:%s`, { encoding: 'utf8' });
  } catch {
    return [];
  }
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
if (!CAMBIOS.length) {
  console.error(
    '✗ Y1: no hay cambios tipados. El historial exige notas estructuradas.\n' +
      '  Edita CAMBIOS_CURADOS en este script o usa commits convencionales (feat/fix/perf/…).',
  );
  process.exit(1);
}
const CHANGELOG = CAMBIOS.map((c) => c.d).join(' ');

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
 * sgc.registrar_version(plataforma, version, notas, titulo, cambios) — con las
 * notas ESTRUCTURADAS (titulo + cambios[]), mismo formato que la web (Y1). El RPC
 * hace UPSERT por (plataforma, version), solo rellena lo vacío y NO toca
 * publicada/minima (las controla el admin). Lanza si el registro falla → el
 * caller aborta el release con exit 1.
 */
async function registrarEnHistorial() {
  const base = URL.replace(/\/$/, '');
  const auth = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  const res = await fetch(`${base}/rest/v1/rpc/registrar_version`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Content-Profile': 'sgc' },
    body: JSON.stringify({
      p_plataforma: 'movil',
      p_version: VERSION,
      p_notas: CHANGELOG,
      p_titulo: TITULO,
      p_cambios: CAMBIOS, // jsonb [{ t, d }] — mismo shape que pinta la web
      // Incluir p_url SIEMPRE: la BD tiene dos overloads de registrar_version
      // (5 y 6 args); mandar p_url desambigua a la de 6 args (PGRST203 si no) y
      // además deja la URL del APK en la fila cuando publicamos al bucket.
      p_url: registerOnly ? null : publicUrl,
    }),
  });
  if (!res.ok) throw new Error(`registrar_version: ${res.status} ${await res.text()}`);
  console.log(`✓ historial registrado (estructurado) vía RPC (v${VERSION})`);

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

// Y1 — el historial DEBE quedar registrado; si falla, el release falla (exit 1)
// para que ninguna versión se escape sin registrar.
try {
  await registrarEnHistorial();
} catch (e) {
  console.error(
    `\n✗ RELEASE FALLÓ: no se pudo registrar la versión en el historial.\n` +
      `  ${e instanceof Error ? e.message : e}\n` +
      `  Regla Y1: ninguna versión debe quedar sin registrar. Corrige y reintenta.`,
  );
  process.exit(1);
}
