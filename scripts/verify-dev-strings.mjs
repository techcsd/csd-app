// verify-dev-strings.mjs — GUARDA DE PRODUCTO (BS2, checklist regla 16). Espejo del
// guard homónimo de SGC (web).
//
// Por qué existe: lo que el usuario ve lo decide su ROL, no el estado del sistema. Un
// error técnico NUNCA le habla en lenguaje de desarrollador — se traduce (mensaje
// humano vía humanizeError/presentarError), se reporta a Tecnología (report_app_error),
// y el detalle técnico (SQLSTATE crudo) solo lo ve `esDesarrollador()` (espejo de
// sgc.es_desarrollador()). El caso real que lo motivó: a Raykler le salía jerga de
// Supabase/SQL en la web (#37). En la app, la red central es ToastService (humaniza el
// tono `error`) + las bandas de error migradas a humanizeError.
//
// Regla: ningún TEMPLATE (`.html`) fuera de `pages/tecnologia/` y `pages/admin/`
// (superficies de desarrollador/administrador) puede contener jerga técnica de base de
// datos/infra dirigida al usuario. Si reaparece, rompe el build — como verify-tokens /
// verify-i18n. Baseline vacío hoy (la app no arrastra jerga en templates).
//
// Escape-hatch legítimo: añade `<!-- dev-strings-allow -->` en la línea.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

// Carpetas de desarrollador/administrador: ahí SÍ se puede hablar técnico.
const EXCLUDE = [join('pages', 'tecnologia'), join('pages', 'admin')];

// Frases prohibidas en un template dirigido al usuario. Español e inglés.
const PROHIBIDO = [
  /SQL Editor/i,
  /\bSupabase\b/i,
  /schema cache/i,
  /ejecuta el sql/i,
  /run the sql/i,
  /aplica la migraci[oó]n/i,
  /migraci[oó]n correspondiente/i,
  /\bno configurad[ao]\b/i,
  /tabla .* no existe/i,
  /row-level security/i,
  /permission denied/i,
];

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

const violations = [];
for (const file of walk(SRC_DIR)) {
  const rel = relative(ROOT, file);
  if (EXCLUDE.some((e) => rel.includes(sep + e + sep) || rel.includes(e + sep))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/dev-strings-allow/.test(line)) return;
    for (const re of PROHIBIDO) {
      if (re.test(line)) {
        violations.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
        break;
      }
    }
  });
}

if (violations.length) {
  console.error(
    `\n\x1b[31m[verify-dev-strings] ✗ ${violations.length} texto(s) de desarrollador en un template de usuario\x1b[0m ` +
      `(regla 16 / BS2). El usuario nunca lee jerga de BD/infra: traduce con humanizeError/` +
      `presentarError (mensaje por rol + reporte a Tecnología; el detalle técnico solo lo ve esDesarrollador()).\n` +
      `Si de verdad es una pantalla de desarrollador, muévela bajo pages/tecnologia|admin ` +
      `o añade "<!-- dev-strings-allow -->" a la línea.\n`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
  process.exit(1);
}

console.log('\x1b[32m[verify-dev-strings] ✓\x1b[0m sin jerga técnica en templates de usuario (regla 16 / BS2).');
process.exit(0);
