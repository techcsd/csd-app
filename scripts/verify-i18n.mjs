/**
 * BR7 — guard de i18n para el prebuild (junto a verify-tokens).
 *
 * Diseño: las CLAVES de traducción SON el texto en español (i18n.service.t()), así
 * que `es` funciona sin catálogo y NUNCA falta una clave — no hay "clave usada que
 * no exista en es". Por eso este guard:
 *   1) FALLA si `public/i18n/en.json` o `ht.json` no existen o no parsean (un JSON
 *      roto rompería la carga del idioma en runtime).
 *   2) AVISA (no falla) cuántos textos usados con `| t` / `i18n.t('…')` aún no están
 *      traducidos en `en` — señal de cobertura, no error (caen a español sin romper).
 *
 * Baseline como verify-tokens: la app arranca en español y se traduce incremental.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const I18N_DIR = join(ROOT, 'public', 'i18n');

function fail(msg) {
  console.error(`\x1b[31m✗ verify-i18n: ${msg}\x1b[0m`);
  process.exit(1);
}

// 1) Los catálogos de traducción deben existir y parsear.
const catalogs = {};
for (const lang of ['en', 'ht']) {
  const p = join(I18N_DIR, `${lang}.json`);
  if (!existsSync(p)) fail(`falta public/i18n/${lang}.json`);
  try {
    catalogs[lang] = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`public/i18n/${lang}.json no es JSON válido: ${e.message}`);
  }
}

// 2) Recolecta los textos usados con el pipe `| t` o el servicio `i18n.t('…')`.
const usados = new Set();
// 'texto' | t   (comilla simple o doble, permite escapes)
const PIPE_RE = /(['"])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b/g;
// .t('texto'   (i18n.t / this.i18n.t)
const CALL_RE = /\.t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (/\.(html|ts)$/.test(name)) {
      const txt = readFileSync(full, 'utf8');
      for (const re of [PIPE_RE, CALL_RE]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(txt))) {
          const s = m[2].replace(/\\(['"])/g, '$1').trim();
          if (s) usados.add(s);
        }
      }
    }
  }
}
walk(SRC);

const sinTraducir = [...usados].filter((s) => !(s in catalogs.en));
console.log(`\x1b[32m✓ verify-i18n:\x1b[0m ${usados.size} textos con t(); en.json cubre ${usados.size - sinTraducir.length}.`);
if (sinTraducir.length) {
  console.log(`\x1b[33m  aviso: ${sinTraducir.length} sin traducir en 'en' (caen a español):\x1b[0m`);
  for (const s of sinTraducir.slice(0, 20)) console.log(`    · ${s}`);
  if (sinTraducir.length > 20) console.log(`    … y ${sinTraducir.length - 20} más`);
}

// 3) BT2 (regla 17) — ALCANCE: las pantallas listadas en `src/app/core/i18n/alcance.json`
//    DEBEN estar 100% cableadas y traducidas en `en`. Lee el reporte por pantalla que
//    dejó `i18n-coverage` (corre antes en el prebuild). Si una pantalla del alcance tiene
//    literales sin t() o no llega a 100% en `en`, FALLA (así el idioma no "se sale" del
//    alcance sin que nadie lo note).
const ALCANCE_P = join(ROOT, 'src', 'app', 'core', 'i18n', 'alcance.json');
const COV_P = join(I18N_DIR, 'coverage.json');
if (existsSync(ALCANCE_P) && existsSync(COV_P)) {
  const alcance = JSON.parse(readFileSync(ALCANCE_P, 'utf8'));
  const pantallas = alcance.pantallas ?? alcance;
  const cov = JSON.parse(readFileSync(COV_P, 'utf8'));
  const problemas = [];
  for (const pant of pantallas) {
    const c = cov.byScreen?.[pant];
    if (!c) {
      problemas.push(`${pant}: no aparece en coverage.json (¿ruta mal escrita?)`);
      continue;
    }
    if (c.sinT > 0) problemas.push(`${pant}: ${c.sinT} literal(es) sin t()`);
    if (c.en < 100) problemas.push(`${pant}: 'en' cubre ${c.en}% (debe ser 100%)`);
  }
  if (problemas.length) {
    console.error(`\x1b[31m✗ verify-i18n: ${problemas.length} pantalla(s) del ALCANCE incompletas:\x1b[0m`);
    for (const p of problemas) console.error(`    · ${p}`);
    console.error(`  Cablea los literales con | t y añade su traducción a en.json, o saca la pantalla del alcance.`);
    process.exit(1);
  }
  console.log(`\x1b[32m✓ verify-i18n:\x1b[0m alcance (${pantallas.length} pantallas) 100% en 'en'.`);
}
process.exit(0);
