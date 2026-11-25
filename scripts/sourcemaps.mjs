// scripts/sourcemaps.mjs — EA: source maps de la app SIN publicarlos.
//
// El build de producción/dev emite maps OCULTOS (angular.json: sourceMap.hidden → el JS no trae
// `sourceMappingURL`). Este script, llamado desde build-env.mjs:
//   retirar     saca TODOS los *.map de dist/ (nunca se despliegan: ni Vercel, ni APK/AAB) a
//               dist-maps/<version>/<canal>/ y, si hay credenciales del entorno, los sube al bucket
//               PRIVADO `app-sourcemaps` (<version>/<canal>/<archivo>.map). Si dist/ aún tuviera un
//               .map, FALLA (fuga de código fuente). Subir es best-effort: un fallo de red no rompe el build.
//   subir       re-sube lo que ya está en dist-maps/<version>/<canal>/.
//   verificar   compara el hash de main-*.js desplegado (--url) con dist-maps/<version>/pwa.
//   alinear     PWA: sube los maps con los nombres con hash del despliegue de Vercel (emparejo por contenido).
//   simbolizar  convierte un stack minificado en archivo:línea del código fuente.
//
// Uso:
//   node scripts/sourcemaps.mjs retirar    --env dev|prod --canal pwa|apk|play|appstore
//   node scripts/sourcemaps.mjs subir      --env dev|prod --canal <canal> [--version X.Y.Z] [--yes]
//   node scripts/sourcemaps.mjs simbolizar --env dev|prod --reporte <uuid de app_error_reports>
//   node scripts/sourcemaps.mjs simbolizar --env dev|prod --version X.Y.Z --canal <canal> [--archivo stack.txt]   (o por stdin)
//
// Credenciales: SUPABASE_URL_<ENV> + SUPABASE_SERVICE_ROLE_KEY_<ENV> (.env.local o entorno). El bucket se crea
// con scripts/data-fixes/2026-11-25-ea-bucket-sourcemaps.mjs (regla 19). Sin dependencias externas.
import './lib/load-env.mjs';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = 'app-sourcemaps';
const [cmd, ...argv] = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); if (i === -1) return undefined; const v = argv[i + 1]; return v && !v.startsWith('--') ? v : true; };

const ENV = flag('env');
if (ENV !== 'dev' && ENV !== 'prod') { console.error('🔴 falta --env dev|prod'); process.exit(1); }
const SUF = ENV.toUpperCase();
const URL_ = process.env[`SUPABASE_URL_${SUF}`] || '';
const KEY = process.env[`SUPABASE_SERVICE_ROLE_KEY_${SUF}`] || '';

function versionDe(env) {
  const f = join(ROOT, 'src', 'environments', `environment.${env}.ts`);
  const m = readFileSync(f, 'utf8').match(/version:\s*'([^']+)'/);
  if (!m) throw new Error(`sin version en ${f}`);
  return m[1];
}

const auth = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}` });
const objUrl = (path) => `${URL_}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

async function subirDir(dir, version, canal) {
  if (!URL_ || !KEY) { console.warn(`⚠ sourcemaps: sin SUPABASE_URL_${SUF}/SUPABASE_SERVICE_ROLE_KEY_${SUF} → NO se subieron (quedan en ${dir}; sube luego con "subir").`); return 0; }
  let ok = 0, fail = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.map'))) {
    try {
      const r = await fetch(objUrl(`${version}/${canal}/${f}`), {
        method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: readFileSync(join(dir, f)),
      });
      if (r.ok) ok++; else { fail++; if (fail <= 2) console.warn(`⚠ sourcemaps: ${f} → HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); }
    } catch (e) { fail++; if (fail <= 2) console.warn(`⚠ sourcemaps: ${f} → ${e.message}`); }
  }
  console.log(`✓ sourcemaps ${ENV}: ${ok} subidos al bucket privado ${BUCKET}/${version}/${canal}${fail ? `, ${fail} fallaron (no rompe el build)` : ''}`);
  return fail;
}

function mapasEn(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...mapasEn(p)); else if (e.name.endsWith('.map')) out.push(p);
  }
  return out;
}

// ── retirar ────────────────────────────────────────────────────────────────
async function retirar() {
  const canal = flag('canal') || 'pwa';
  const dist = join(ROOT, 'dist', 'csd-app', 'browser');
  if (!existsSync(dist)) { console.error(`🔴 sourcemaps: no existe ${dist}`); process.exit(1); }
  const version = versionDe(ENV);
  const dest = join(ROOT, 'dist-maps', version, canal);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const maps = mapasEn(dist);
  for (const m of maps) renameSync(m, join(dest, m.split(/[\\/]/).pop()));
  // El service worker hashea lo que ve en dist; no debe referenciar maps.
  const ngsw = join(dist, 'ngsw.json');
  if (existsSync(ngsw) && /\.map"/.test(readFileSync(ngsw, 'utf8'))) { console.error('🔴 sourcemaps: ngsw.json referencia .map'); process.exit(1); }
  const quedan = mapasEn(dist);
  if (quedan.length) { console.error(`🔴 sourcemaps: quedan ${quedan.length} .map en dist/ (fuga de código fuente)`); process.exit(1); }
  console.log(`✓ sourcemaps: ${maps.length} .map retirados de dist/ → dist-maps/${version}/${canal}/`);
  if (maps.length) await subirDir(dest, version, canal);
}

// ── subir ──────────────────────────────────────────────────────────────────
async function subir() {
  const canal = flag('canal') || 'pwa';
  const version = typeof flag('version') === 'string' ? flag('version') : versionDe(ENV);
  if (ENV === 'prod' && !flag('yes')) { console.error('🔴 prod requiere --yes (Xaviel ya dio el OK de release).'); process.exit(1); }
  const dir = join(ROOT, 'dist-maps', version, canal);
  if (!existsSync(dir)) { console.error(`🔴 no existe ${dir}`); process.exit(1); }
  process.exit((await subirDir(dir, version, canal)) ? 1 : 0);
}

// ── simbolizar ─────────────────────────────────────────────────────────────
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]));
function decodificar(mappings) {
  // → lineas[] de segmentos [colGen, srcIdx, linOrig, colOrig, nameIdx?] (absolutos, 0-based)
  const lineas = [];
  let src = 0, lo = 0, co = 0, nm = 0;
  for (const linea of mappings.split(';')) {
    let cg = 0;
    const segs = [];
    if (linea) for (const seg of linea.split(',')) {
      const v = []; let shift = 0, val = 0;
      for (const ch of seg) {
        const d = B64I[ch]; val += (d & 31) << shift;
        if (d & 32) { shift += 5; } else { v.push(val & 1 ? -(val >> 1) : val >> 1); val = 0; shift = 0; }
      }
      cg += v[0];
      if (v.length >= 4) { src += v[1]; lo += v[2]; co += v[3]; if (v.length >= 5) nm += v[4]; segs.push([cg, src, lo, co, v.length >= 5 ? nm : -1]); }
    }
    lineas.push(segs);
  }
  return lineas;
}
function buscar(mapa, linea1, col1) {
  const segs = mapa.lineas[linea1 - 1]; if (!segs?.length) return null;
  let r = null;
  for (const s of segs) { if (s[0] <= col1 - 1) r = s; else break; }
  if (!r) return null;
  return { fuente: mapa.json.sources[r[1]].replace(/^(\.\.\/)+/, ''), linea: r[2] + 1, col: r[3] + 1, nombre: r[4] >= 0 ? mapa.json.names[r[4]] : null };
}

async function simbolizar() {
  if (!URL_ || !KEY) { console.error(`🔴 faltan SUPABASE_URL_${SUF}/SUPABASE_SERVICE_ROLE_KEY_${SUF}`); process.exit(1); }
  let version = typeof flag('version') === 'string' ? flag('version') : null;
  let canal = typeof flag('canal') === 'string' ? flag('canal') : null;
  let stack = '';
  const rep = flag('reporte');
  if (typeof rep === 'string') {
    const r = await fetch(`${URL_}/rest/v1/app_error_reports?id=eq.${encodeURIComponent(rep)}&select=app_version,platform,message,stack,context`, { headers: { ...auth(), 'Accept-Profile': 'sgc' } });
    const [row] = await r.json();
    if (!row) { console.error('🔴 reporte no encontrado'); process.exit(1); }
    version = version || row.app_version;
    canal = canal || row.context?.canal || (row.platform === 'web' ? 'pwa' : 'apk');
    stack = row.stack || '';
    console.log(`reporte ${rep} · v${version} · canal ${canal}\n${row.message}\n`);
  } else if (typeof flag('archivo') === 'string') {
    stack = readFileSync(flag('archivo'), 'utf8');
  } else {
    stack = readFileSync(0, 'utf8');
  }
  if (!version || !canal) { console.error('🔴 faltan --version y --canal (o --reporte)'); process.exit(1); }
  const cache = new Map();
  const cargar = async (archivo) => {
    if (cache.has(archivo)) return cache.get(archivo);
    let m = null;
    const loc = join(ROOT, 'dist-maps', version, canal, `${archivo}.map`);
    let txt = existsSync(loc) ? readFileSync(loc, 'utf8') : null;
    if (txt === null) {
      const r = await fetch(objUrl(`${version}/${canal}/${archivo}.map`), { headers: auth() });
      if (r.ok) txt = await r.text();
    }
    if (txt) { const json = JSON.parse(txt); m = { json, lineas: decodificar(json.mappings) }; }
    cache.set(archivo, m);
    return m;
  };
  const RE = /([A-Za-z0-9_.-]+\.js):(\d+):(\d+)/;
  let resueltas = 0, total = 0;
  for (const linea of stack.split('\n')) {
    const m = linea.match(RE);
    if (!m) { console.log(linea); continue; }
    total++;
    const mapa = await cargar(m[1]);
    const o = mapa && buscar(mapa, +m[2], +m[3]);
    if (o) { resueltas++; console.log(`${linea.trim()}\n    → ${o.fuente}:${o.linea}:${o.col}${o.nombre ? ` (${o.nombre})` : ''}`); }
    else console.log(`${linea.trim()}\n    → (sin mapa para ${m[1]} en v${version}/${canal})`);
  }
  console.log(`\n${resueltas}/${total} frames resueltos`);
  process.exit(total && !resueltas ? 2 : 0);
}

// ── alinear ────────────────────────────────────────────────────────────────
// Vercel compila en Linux y los nombres con hash (chunk-XXXX.js) NO coinciden con los del build local aunque el
// contenido sea el mismo (el hash cascadea). Aquí se baja el JS DESPLEGADO, se empareja con el JS local por contenido
// (ignorando los nombres con hash) y se suben los maps con los nombres del despliegue. Requiere dist/ del build local
// de ESTE mismo commit (node scripts/build-env.mjs --env <env> --canal pwa) y dist-maps/<version>/pwa.
async function alinear() {
  const url = typeof flag('url') === 'string' ? flag('url') : (ENV === 'prod' ? 'https://app.sgcconstructorasd.com/' : 'https://app-dev.sgcconstructorasd.com/');
  const version = typeof flag('version') === 'string' ? flag('version') : versionDe(ENV);
  if (ENV === 'prod' && !flag('yes')) { console.error('🔴 prod requiere --yes'); process.exit(1); }
  if (!URL_ || !KEY) { console.error('🔴 faltan credenciales del entorno'); process.exit(1); }
  const dist = join(ROOT, 'dist', 'csd-app', 'browser'), maps = join(ROOT, 'dist-maps', version, 'pwa');
  const norm = (t) => t.replace(/[A-Za-z0-9_.]*-[A-Z0-9]{8}.js/g, 'X.js');
  const base = new URL(url).origin + '/';
  const ngsw = await (await fetch(base + 'ngsw.json', { cache: 'no-store' })).json();
  const vivos = [...new Set(ngsw.assetGroups.flatMap((g) => g.urls).map((u) => u.slice(1)).filter((u) => u.endsWith('.js')))];
  const locales = readdirSync(dist).filter((x) => x.endsWith('.js') && existsSync(join(maps, x + '.map')));
  const porContenido = new Map();
  for (const l of locales) { const k = norm(readFileSync(join(dist, l), 'utf8')); const a = porContenido.get(k) || []; a.push(l); porContenido.set(k, a); }
  let ok = 0, sin = 0;
  for (const v of vivos) {
    const t = norm(await (await fetch(base + v, { cache: 'no-store' })).text());
    const l = (porContenido.get(t) || []).shift();
    if (!l) { sin++; continue; }
    const r = await fetch(objUrl(`${version}/pwa/${v}.map`), { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: readFileSync(join(maps, l + '.map')) });
    if (r.ok) ok++; else { sin++; console.warn(`⚠ ${v} → HTTP ${r.status}`); }
  }
  console.log(`✓ alinear ${ENV}: ${ok}/${vivos.length} maps subidos con los nombres del despliegue${sin ? `, ${sin} sin pareja` : ''}`);
  process.exit(sin ? 1 : 0);
}

// ── verificar ──────────────────────────────────────────────────────────────
// ¿Los maps de dist-maps/<version>/pwa corresponden al PWA DESPLEGADO? (mismo hash de main-*.js)
async function verificar() {
  const url = typeof flag('url') === 'string' ? flag('url') : (ENV === 'prod' ? 'https://app.sgcconstructorasd.com/' : 'https://app-dev.sgcconstructorasd.com/');
  const version = typeof flag('version') === 'string' ? flag('version') : versionDe(ENV);
  const html = await (await fetch(url, { cache: 'no-store' })).text();
  const m = html.match(/(main-[A-Z0-9]+\.js)/);
  if (!m) { console.error('🔴 no pude leer main-*.js del index desplegado'); process.exit(1); }
  const ok = existsSync(join(ROOT, 'dist-maps', version, 'pwa', m[1] + '.map'));
  console.log(ok
    ? `✓ el PWA desplegado (${m[1]}) coincide con dist-maps/${version}/pwa`
    : `🔴 el PWA desplegado usa ${m[1]} y NO hay mapa local para esa versión: el build local no es idéntico al de Vercel (¿otro commit/canal, o Vercel compiló en otra plataforma?). Corre: sourcemaps.mjs alinear --env ${ENV} --yes`);
  process.exit(ok ? 0 : 1);
}

const acciones = { retirar, subir, simbolizar, verificar, alinear };
if (!acciones[cmd]) { console.error('uso: sourcemaps.mjs retirar|subir|simbolizar|verificar|alinear --env dev|prod …'); process.exit(1); }
await acciones[cmd]();
