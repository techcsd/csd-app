/**
 * CL5 · Data-fix VERSIONADO (regla 19) — upsert de las filas `sistema='app'` del
 * registro de movimiento de la app en `sgc.movimiento_catalogo` (la pantalla del
 * catálogo es de la WEB, PROMPT-92 F7; aquí el hijo solo publica SUS filas).
 *
 *   node scripts/data-fixes/2026-10-10-cl5-movimiento-catalogo-app.mjs --env dev           # DRY-RUN (default)
 *   node scripts/data-fixes/2026-10-10-cl5-movimiento-catalogo-app.mjs --env dev --apply    # aplica
 *
 * ⚠️ BLOQUEADO POR EL PADRE: `sgc.movimiento_catalogo` aún NO existe (PROMPT-92 F7 sin
 * shippear → 404 en dev). El script DETECTA eso y aborta limpio; cuando el padre cree
 * la tabla, corre con --apply. Idempotente (upsert por id). Fuente: el registro vivo de
 * la app en `src/app/core/motion/catalogo-movimiento.ts` (se lee y se filtra sistema='app').
 */
import { readFileSync } from 'node:fs';
import { resolverEnv } from '../lib/entorno.mjs';

const APPLY = process.argv.includes('--apply');
const env = await resolverEnv(process.argv.slice(2));
const URL = env.url, KEY = env.serviceKey;
if (!URL || !KEY) {
  console.error(`✗ Faltan SUPABASE_URL_${env.entorno.toUpperCase()} / SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`);
  process.exit(1);
}
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', 'Content-Type': 'application/json' };

// 1) Leer el registro vivo de la app (TS) y extraer el array de objetos literales.
//    Los valores son literales + casts `as X`; quitamos los casts → JS válido → eval seguro
//    (archivo propio, versionado; no hay entrada de usuario).
function cargarCatalogoApp() {
  const src = readFileSync('src/app/core/motion/catalogo-movimiento.ts', 'utf8');
  const m = src.match(/MOVIMIENTO_CATALOGO\s*(?::[^=]+)?=\s*(\[[\s\S]*?\]);/);
  if (!m) throw new Error('No pude ubicar MOVIMIENTO_CATALOGO en el .ts');
  // Consts simples usadas dentro del array (p.ej. EASE_OUT='ease-out') → inyectarlas.
  const consts = [...src.matchAll(/^const\s+([A-Z_][A-Z0-9_]*)\s*=\s*('[^']*'|"[^"]*");/gm)]
    .map((c) => `const ${c[1]}=${c[2]};`).join('');
  const literal = m[1].replace(/\s+as\s+[A-Za-z_][\w<>'"[\]| .]*/g, '');
  // eslint-disable-next-line no-eval
  const arr = eval(consts + '(' + literal + ')');
  return arr.filter((r) => r.sistema === 'app');
}

let filas;
try {
  filas = cargarCatalogoApp();
} catch (e) {
  console.error('✗ No pude leer el catálogo de la app:', e.message);
  process.exit(1);
}
console.log(`• filas sistema='app' en el registro: ${filas.length}`);

// 2) ¿Existe la tabla en este entorno? (PROMPT-92 F7)
const probe = await fetch(URL + '/rest/v1/movimiento_catalogo?select=id&limit=1', { headers: H });
if (probe.status === 404 || probe.status === 400) {
  console.error(`\n⚠️  sgc.movimiento_catalogo NO existe en ${env.entorno} (status ${probe.status}).`);
  console.error('   Es del PADRE (PROMPT-92 F7). Cuando la cree, vuelve a correr con --apply.');
  console.error('   (El hijo no crea DDL — regla 18/19.) Abortado limpio.');
  process.exit(2);
}

// 3) Upsert (idempotente por id).
if (!APPLY) {
  console.log(`\n(DRY-RUN) Se haría upsert de ${filas.length} filas. Corre con --apply para aplicar.`);
  console.log('  ids:', filas.map((r) => r.id).join(', '));
  process.exit(0);
}
const res = await fetch(URL + '/rest/v1/movimiento_catalogo', {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(filas),
});
if (!res.ok) {
  console.error(`✗ upsert falló: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`✓ upsert OK de ${filas.length} filas sistema='app' en movimiento_catalogo (${env.entorno}).`);
