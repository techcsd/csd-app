// verify-pickers.mjs — GUARDA DE REGRESIÓN (BW2). Espejo del lint homónimo del
// padre (SGC `verify-regresiones`).
//
// Un componente CONTROLADO pinta su valor desde `[value]` y solo EMITE su cambio
// (`(selectionChange)`). Si el template escucha el cambio pero NO bindea `[value]`,
// es un "control mudo": el usuario elige y la UI nunca refleja la elección — fue
// exactamente el bug BW2 en la web (app-articulo-picker en "Vincular a un artículo",
// la echada "Ties 20CM" que nunca se aplicaba).
//
// Regla: todo elemento con `(selectionChange)` DEBE llevar `[value]` (o `[ngModel]`
// / `[selected]`). Además, los pickers controlados nombrados
// (`<app-articulo-picker>`, `<app-user-picker>`, `<app-filter-select>`) con su
// evento de cambio deben bindear su valor.
//
// Escape-hatch legítimo (raro): añade `<!-- pickers-allow -->` en la misma línea
// de apertura del elemento.
//
// Nota: los pickers de ESTA app son en su mayoría no-controlados (emiten `(picked)`
// al tocar), así que el baseline arranca vacío; el guard es preventivo.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

// Eventos de "cambio" de un control controlado.
const CHANGE_RE = /\((selectionChange|valueChange)\)/;
// Bindings que satisfacen "pinta lo elegido".
const VALUE_RE = /\[(value|values|ngModel|selected)\]/;
// Componentes controlados nombrados (espejo de la web).
const NAMED = /<app-(articulo-picker|user-picker|filter-select)\b/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Devuelve el texto de la etiqueta de apertura que contiene la posición `pos`,
 *  respetando comillas (para no cortar en un `>` dentro de una expresión). */
function tagAround(html, pos) {
  const start = html.lastIndexOf('<', pos);
  if (start < 0) return null;
  let q = null;
  let i = start + 1;
  for (; i < html.length; i++) {
    const c = html[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === '>') {
      break;
    }
  }
  return { text: html.slice(start, i + 1), start };
}

const violations = [];
for (const file of walk(SRC_DIR)) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const seen = new Set();

  // 1) Cualquier elemento con (selectionChange)/(valueChange) sin [value].
  for (const m of html.matchAll(/\((?:selectionChange|valueChange)\)/g)) {
    const tag = tagAround(html, m.index);
    if (!tag || seen.has(tag.start)) continue;
    seen.add(tag.start);
    if (/pickers-allow/.test(tag.text)) continue;
    if (!VALUE_RE.test(tag.text)) {
      const line = html.slice(0, tag.start).split('\n').length;
      violations.push({ file: rel, line, why: 'control con (selectionChange) sin [value]' });
    }
  }

  // 2) Pickers controlados nombrados con evento de cambio sin [value].
  for (const m of html.matchAll(/<app-(?:articulo-picker|user-picker|filter-select)\b/g)) {
    const tag = tagAround(html, m.index);
    if (!tag || seen.has(tag.start)) continue;
    if (/pickers-allow/.test(tag.text)) continue;
    if (CHANGE_RE.test(tag.text) && !VALUE_RE.test(tag.text)) {
      seen.add(tag.start);
      const line = html.slice(0, tag.start).split('\n').length;
      violations.push({ file: rel, line, why: `${NAMED.exec(tag.text)?.[0]} controlado sin [value]` });
    }
  }
}

if (violations.length) {
  console.error(`\n\x1b[31m[verify-pickers] ✗ ${violations.length} control(es) controlado(s) sin [value]:\x1b[0m`);
  for (const v of violations) console.error(`  ${v.file}:${v.line}  — ${v.why}`);
  console.error('\n  Un control que escucha su cambio pero no bindea [value] no pinta la elección (bug BW2).');
  console.error('  Añade [value]="…" (o [ngModel]) al elemento. Escape legítimo: <!-- pickers-allow -->.\n');
  process.exit(1);
}
console.log('\x1b[32m[verify-pickers] ✓\x1b[0m sin controles controlados mudos.');
process.exit(0);
