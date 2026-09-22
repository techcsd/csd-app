/**
 * BU1 F0 — guarda de prebuild: ningún archivo del repo puede hardcodear el ref del
 * proyecto de PROD. La URL/ref del entorno sale de environment.<env>.ts (build) o
 * de .env.local (scripts) — nunca de un literal disperso. Cumple la regla 18: es
 * imposible que código nuevo apunte a prod "sin querer".
 *
 * Único lugar permitido: src/environments/environment.prod.ts (la fuente del build
 * de prod, con la anon key pública). .env.local no se escanea (gitignored, secreto).
 * Se escanean src/, scripts/, android/ (sin build/ artefactos ni node_modules).
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROD_REF = 'jeeqhgccqefbqilntcpu';
const ROOTS = ['src', 'scripts', 'android'];
const ALLOW = new Set([
  'src/environments/environment.prod.ts', // fuente del build de prod (anon pública)
  'src/environments/environment.ts', // GENERADO (gitignored): build-env copia dev/prod aquí
  'scripts/verify-sin-ref-hardcodeado.mjs', // este guarda declara el literal a buscar
  'scripts/lib/entorno.mjs', // resolver de entorno compartido (único literal permitido, = padre)
]);
// assets/ bajo android es la salida de `cap sync` (copia de dist) — no es fuente.
const SKIP_PATHS = ['android/app/src/main/assets'];
const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle', 'dist', '.angular', 'capacitor-cordova-android-plugins']);
const EXT = /\.(ts|js|mjs|cjs|json|java|kt|gradle|xml|html|scss|properties)$/i;

const hits = [];
function walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    const rel = full.replace(/\\/g, '/');
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
      walk(full);
    } else if (EXT.test(name)) {
      if (ALLOW.has(rel)) continue;
      let txt;
      try { txt = readFileSync(full, 'utf8'); } catch { continue; }
      if (txt.includes(PROD_REF)) {
        const line = txt.split(/\r?\n/).findIndex((l) => l.includes(PROD_REF)) + 1;
        hits.push(`${rel}:${line}`);
      }
    }
  }
}

for (const r of ROOTS) walk(r);

if (hits.length) {
  console.error('\n🔴 Ref de PROD hardcodeado fuera de environment.prod.ts (regla 18):');
  for (const h of hits) console.error('   ' + h);
  console.error('\n   Usa environment.<env>.ts (build) o SUPABASE_*_<ENV> de .env.local (scripts).\n');
  process.exit(1);
}
console.log('✓ sin ref de prod hardcodeado (BU1 F0).');
