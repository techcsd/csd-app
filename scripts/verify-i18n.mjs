/**
 * BR7/DP-13 — guard de i18n del prebuild (corre después de i18n-coverage).
 *
 * Las CLAVES de traducción SON el texto en español (i18n.service.t()), así que `es`
 * no necesita catálogo. Este guard FALLA (exit 1) si:
 *   1) `public/i18n/en.json` o `ht.json` no existen / no parsean.
 *   2) (DP-13a/b) una pantalla con `enforce:true` en `src/app/core/i18n/alcance.json`
 *      tiene literales sin t() (HTML o .ts) o claves usadas que faltan en en.json/ht.json.
 *   3) (DP-13) algún catálogo tiene un valor vacío o pierde un {placeholder} de su clave.
 * Fuera de las pantallas enforce solo AVISA (conteo), para no bloquear lotes en curso.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const I18N_DIR = join(ROOT, 'public', 'i18n');
const fail = (msg) => {
  console.error(`\x1b[31m✗ verify-i18n: ${msg}\x1b[0m`);
  process.exit(1);
};

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

// 3) integridad de valores
const ph = (s) => (s.match(/\{[a-zA-Z_]+\}/g) || []).sort().join(',');
const rotos = [];
for (const lang of ['en', 'ht']) {
  for (const [k, v] of Object.entries(catalogs[lang])) {
    if (typeof v !== 'string' || !v.trim()) rotos.push(`${lang}: "${k}" vacío`);
    else if (ph(k) !== ph(v)) rotos.push(`${lang}: "${k}" pierde/cambia placeholders → "${v}"`);
  }
}
if (rotos.length) {
  console.error(`\x1b[31m✗ verify-i18n: ${rotos.length} entrada(s) de catálogo inválidas:\x1b[0m`);
  rotos.slice(0, 20).forEach((r) => console.error(`    · ${r}`));
  process.exit(1);
}

// 2) enforce por pantalla
const ALCANCE_P = join(ROOT, 'src', 'app', 'core', 'i18n', 'alcance.json');
const COV_P = join(I18N_DIR, 'coverage.json');
if (!existsSync(ALCANCE_P) || !existsSync(COV_P)) fail('faltan alcance.json o coverage.json (corre i18n-coverage antes)');
const alcance = JSON.parse(readFileSync(ALCANCE_P, 'utf8'));
const cov = JSON.parse(readFileSync(COV_P, 'utf8'));
const pantallas = Array.isArray(alcance.pantallas)
  ? alcance.pantallas.map((p) => [p, true])
  : Object.entries(alcance.pantallas ?? {}).map(([k, v]) => [k, !!v?.enforce]);

const problemas = [];
let nEnforce = 0;
let sinEnforceConDeuda = 0;
for (const [pant, enforce] of pantallas) {
  const c = cov.byScreen?.[pant];
  if (!c) {
    if (enforce) problemas.push(`${pant}: no aparece en coverage.json (¿ruta mal escrita?)`);
    continue;
  }
  const deuda = c.sinT + c.faltaEn + c.faltaHt;
  if (!enforce) {
    if (deuda > 0) sinEnforceConDeuda++;
    continue;
  }
  nEnforce++;
  if (c.sinT > 0) problemas.push(`${pant}: ${c.sinT} literal(es) sin t()`);
  if (c.faltaEn > 0) problemas.push(`${pant}: ${c.faltaEn} clave(s) sin traducir en en.json`);
  if (c.faltaHt > 0) problemas.push(`${pant}: ${c.faltaHt} clave(s) sin traducir en ht.json`);
}
if (problemas.length) {
  console.error(`\x1b[31m✗ verify-i18n: ${problemas.length} problema(s) en pantallas enforce:\x1b[0m`);
  problemas.slice(0, 40).forEach((p) => console.error(`    · ${p}`));
  console.error('  Envuelve el literal con t() y agrega su traducción a en.json y ht.json (docs/I18N-GLOSARIO.md).');
  process.exit(1);
}
console.log(
  `\x1b[32m✓ verify-i18n:\x1b[0m ${nEnforce} de ${pantallas.length} pantallas enforce sin deuda · en ${cov.en}% · ht ${cov.ht}%` +
    (sinEnforceConDeuda ? ` · aviso: ${sinEnforceConDeuda} pantalla(s) sin enforce con deuda` : ''),
);
process.exit(0);
