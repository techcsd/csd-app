// verify-tokens.mjs — GUARDA DE DISEÑO (BH5). Corre en cada build (prebuild + APK).
//
// Portada de la web (SGC/scripts/verify-tokens.mjs). Por qué existe: el tema oscuro
// de la app (BE/BH5) se rompe cuando un componente usa un hex OSCURO quemado como
// valor de FONDO o BORDE — copiado del vocabulario dark de otro proyecto X-Dev
// (#161616 / #121212 / #1a1a1a / #212121 / #2d2d2d …). En una superficie clara sale
// como panel/borde oscuro sobre claro; y bloquea que el token themee. Se limpiaron;
// este script impide que vuelvan: falla el build si el patrón reaparece.
//
// Regla: en cualquier `.scss` bajo `src/`, un `background|border*:` cuyo VALOR
// contenga uno de esos hex (y NO sea un fallback dentro de `var(--x, #hex)`) es un
// error. La tinta oscura sobre ámbar (`color:#121212` en un fill --Hub) y el blanco
// sobre marca NO se tocan (no son fondo/borde oscuro): `color` queda fuera a propósito.
//
// Escape-hatch legítimo (un documento imprimible "papel", p. ej. el carnet de
// personal): añade `// tokens-allow-dark` al final de la línea y el guard la ignora.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, '..', 'src');

// Hex oscuros del vocabulario X-Dev (near-black). Solo estos: no perseguimos
// grises legítimos ni la tinta de documentos.
const DARK_HEX = /#(161616|121212|1a1a1a|1e1e1e|212121|2d2d2d|0f0f0f|181818|222222|262626)\b/i;
// Declaración de SUPERFICIE/BORDE (donde un oscuro = el bug). Captura el VALOR.
// `color` queda fuera a propósito (tinta oscura sobre ámbar/marca es correcta).
// `border(-…)?` no matchea `border-radius` (radius no está en la alternancia).
const SURFACE_DECL =
  /\b(background(?:-color)?|border(?:-(?:top|bottom|left|right|color))?)\s*:\s*([^;{}]+)/gi;
const ALLOW = /tokens-allow-dark/;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.scss')) out.push(p);
  }
  return out;
}

// ¿el valor tiene un oscuro REAL (no solo dentro de un fallback `var(--x, #hex)`)?
function valueHasRealDark(value) {
  return DARK_HEX.test(value.replace(/var\([^)]*\)/g, ''));
}

const violations = [];
for (const file of walk(SRC_DIR)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    if (!DARK_HEX.test(line)) return; // atajo: la línea no tiene ningún oscuro
    for (const m of line.matchAll(SURFACE_DECL)) {
      const value = m[2];
      if (valueHasRealDark(value)) {
        violations.push({
          file: relative(join(__dirname, '..'), file),
          line: i + 1,
          text: `${m[1]}: ${value.trim()}`,
        });
        break; // una violación por línea basta
      }
    }
  });
}

if (violations.length) {
  console.error(
    `\n[verify-tokens] ✗ ${violations.length} fondo/borde oscuro heredado (fingerprint X-Dev) — ` +
      `usa un token semántico (var(--surface|--surface-2|--border)) en vez del hex oscuro.\n` +
      `Si de verdad debe ser oscuro (documento "papel", carnet), añade "// tokens-allow-dark" a la línea.\n`,
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
  process.exit(1);
}

console.log('[verify-tokens] ✓ sin fondos/bordes oscuros heredados (fingerprint X-Dev limpio).');
