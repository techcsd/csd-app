// verify-tokens.mjs — GUARDA DE DISEÑO (BH5). Corre en cada build (prebuild + APK).
//
// Portada de la web (SGC/scripts/verify-tokens.mjs). Por qué existe: el tema oscuro
// de la app (BE/BH5) se rompe cuando un componente usa un hex quemado como valor de
// FONDO o BORDE en vez de un token semántico — porque un hex literal NO themea.
//
// DOS chequeos:
//   (1) NEAR-BLACK (estricto, sin baseline): un hex oscuro del vocabulario X-Dev
//       (#161616 / #121212 / #1a1a1a / #212121 / #2d2d2d …) como fondo/borde. Sale
//       como panel oscuro sobre claro. Debe ser SIEMPRE cero; rompe el build al toque.
//   (2) SURFACE-HEX (ratchet con baseline): CUALQUIER hex literal como fondo/borde
//       (oscuro U OSCURO CLARO). Añadido en la auditoría 14-sep: el guard portado solo
//       veía near-black, pero el bug REAL de BH5 en la app eran fondos CLAROS quemados
//       (#fff7ed, #fdeaea, #e7f6ec…) — pastillas de estado que quedan como islas claras
//       ilegibles en tema oscuro. Un fondo/borde debe ser `var(--surface|--border|…)`,
//       nunca un hex. La deuda existente (65+ sitios) se congela en un baseline
//       versionado; el guard solo rompe por sitios NUEVOS. Tras limpiar deuda de
//       verdad, regenera con `--update-baseline`.
//
// `color` queda fuera a propósito (tinta oscura sobre ámbar/marca es correcta).
// Escape-hatch legítimo (un documento imprimible "papel", p. ej. el carnet de
// personal): añade `// tokens-allow-dark` al final de la línea y el guard la ignora.

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'src');
const BASELINE_FILE = join(__dirname, '.token-surface-hex-baseline.json');
const UPDATE_BASELINE = process.argv.includes('--update-baseline');

// Hex oscuros del vocabulario X-Dev (near-black). Chequeo estricto, sin baseline.
const DARK_HEX = /#(161616|121212|1a1a1a|1e1e1e|212121|2d2d2d|0f0f0f|181818|222222|262626)\b/i;
// Cualquier hex literal (#rgb / #rrggbb / #rrggbbaa). Chequeo (2).
const ANY_HEX = /#[0-9a-fA-F]{3,8}\b/;
// Declaración de SUPERFICIE/BORDE (donde un hex quemado = el bug). Captura el VALOR.
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

// ¿el valor tiene un hex REAL (no solo dentro de un fallback `var(--x, #hex)`)?
function stripVars(value) {
  return value.replace(/var\([^)]*\)/g, '');
}
function norm(s) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

const nearBlack = [];
const surfaceHex = []; // { id, file, line, text }
for (const file of walk(SRC_DIR)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.test(line)) return;
    if (!ANY_HEX.test(line)) return; // atajo: la línea no tiene ningún hex
    for (const m of line.matchAll(SURFACE_DECL)) {
      const bare = stripVars(m[2]);
      if (!ANY_HEX.test(bare)) continue; // el hex solo vivía en un var(--x,#hex): OK
      const text = `${m[1]}: ${m[2].trim()}`;
      // (2) surface-hex ratchet: cualquier hex literal de fondo/borde
      surfaceHex.push({ id: `${rel}::${norm(text)}`, file: rel, line: i + 1, text });
      // (1) near-black estricto
      if (DARK_HEX.test(bare)) nearBlack.push({ file: rel, line: i + 1, text });
    }
  });
}

// ── Ratchet de baseline para el chequeo (2) ──────────────────────────────────
let baseline = [];
if (existsSync(BASELINE_FILE)) {
  try { baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')); } catch { baseline = []; }
}
const baselineSet = new Set(baseline);
const currentIds = surfaceHex.map((v) => v.id);
const currentSet = new Set(currentIds);
if (UPDATE_BASELINE) {
  writeFileSync(BASELINE_FILE, JSON.stringify([...currentSet].sort(), null, 2) + '\n');
  console.log(`[verify-tokens] ✓ baseline de surface-hex regenerado (${currentSet.size} entradas).`);
  process.exit(0);
}
const newSurface = surfaceHex.filter((v) => !baselineSet.has(v.id));
const resolvedDebt = baseline.filter((b) => !currentSet.has(b));

// ── Reporte ──────────────────────────────────────────────────────────────────
let failed = false;

if (nearBlack.length) {
  failed = true;
  console.error(
    `\n[verify-tokens] ✗ ${nearBlack.length} fondo/borde OSCURO heredado (fingerprint X-Dev) — ` +
      `usa un token semántico (var(--surface|--surface-2|--border)) en vez del hex oscuro.\n` +
      `Si de verdad debe ser oscuro (documento "papel", carnet), añade "// tokens-allow-dark" a la línea.\n`,
  );
  for (const v of nearBlack) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error('');
} else {
  console.log('[verify-tokens] ✓ sin fondos/bordes oscuros heredados (fingerprint X-Dev limpio).');
}

if (newSurface.length) {
  failed = true;
  console.error(
    `\n[verify-tokens] ✗ ${newSurface.length} fondo/borde con HEX QUEMADO NUEVO (no themea en oscuro — el bug de BH5):\n`,
  );
  for (const v of newSurface) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  console.error(
    `\nUn fondo/borde debe ser un token (var(--surface|--surface-2|--surface-3|--border|--*-bg)),\n` +
      `no un hex literal — un hex no themea y sale como isla clara/oscura en el otro tema.\n` +
      `Si es un documento "papel" legítimo, añade "// tokens-allow-dark" a la línea.\n` +
      `Si limpiaste deuda existente, corre: node scripts/verify-tokens.mjs --update-baseline\n`,
  );
} else {
  console.log(
    `[verify-tokens] ✓ sin hex de superficie nuevos (deuda congelada en baseline: ${baseline.length}).`,
  );
}
if (resolvedDebt.length) {
  console.log(
    `[verify-tokens] ℹ ${resolvedDebt.length} entrada(s) del baseline ya no existen; corre --update-baseline para depurarlo.`,
  );
}

process.exit(failed ? 1 : 0);
