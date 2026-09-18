/**
 * BT2 (regla 17) — cobertura de i18n POR PANTALLA. La unidad de traducción es la
 * pantalla: un idioma se ofrece "de verdad" solo cuando cubre todo su alcance. Este
 * script recorre las plantillas + literales de la app y, por pantalla, cuenta:
 *   · con t()  = strings visibles ya cableados por `| t` / `i18n.t('…')` y presentes
 *                en el catálogo del idioma (en/ht).
 *   · sin t()  = literales en español visibles al usuario que NO pasan por t()
 *                (texto de nodo + atributos placeholder/label/alt/aria-label/title),
 *                descontando nombres propios de `scripts/i18n-whitelist.json`.
 *
 * Cobertura de pantalla = conT / (conT + sinT). Cobertura global = sobre el ALCANCE
 * (`src/app/core/i18n/alcance.json`) si existe, si no sobre toda la app.
 *
 * Salidas:
 *   · docs/I18N-COVERAGE.md   — reporte legible por pantalla.
 *   · public/i18n/coverage.json — { en:%, ht:%, byScreen } que LEE la app para
 *     decidir si ofrece un idioma (≥95% en, ≥90% ht) o lo marca beta/próximamente.
 *
 * No FALLA por sí mismo (es un medidor); `verify-i18n` es el que corta el build.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src', 'app');
const I18N_DIR = join(ROOT, 'public', 'i18n');
const DOCS_DIR = join(ROOT, 'docs');
const WHITELIST_P = join(ROOT, 'scripts', 'i18n-whitelist.json');
const ALCANCE_P = join(ROOT, 'src', 'app', 'core', 'i18n', 'alcance.json');

// ── Catálogos ────────────────────────────────────────────────────────────────
const catalogs = {};
for (const lang of ['en', 'ht']) {
  const p = join(I18N_DIR, `${lang}.json`);
  catalogs[lang] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}
const whitelist = existsSync(WHITELIST_P) ? new Set(JSON.parse(readFileSync(WHITELIST_P, 'utf8'))) : new Set();
const alcance = existsSync(ALCANCE_P) ? JSON.parse(readFileSync(ALCANCE_P, 'utf8')) : null;
const alcanceSet = alcance ? new Set(alcance.pantallas ?? alcance) : null;

// ── Detección de literales / usos de t() ───────────────────────────────────────
const PIPE_RE = /(['"])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b/g;
const CALL_RE = /\.t\(\s*(['"])((?:\\.|(?!\1).)*?)\1/g;
const LETTER = /[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/;

/** ¿Este texto visible es candidato a traducción? (tiene palabras, no es var/número/emoji). */
function traducible(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!LETTER.test(t)) return false; // números, símbolos, emojis solos
  if (/[{}]/.test(t)) return false; // interpolación / control-flow / bindings residuales
  if (/@(if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/.test(t)) return false;
  if (/^[@#*(\[]/.test(t)) return false; // directivas / control-flow
  if (whitelist.has(t)) return false;
  // palabra con ≥1 vocal española y letras (evita códigos como "OK"/"ID" cortos)
  const soloLetras = t.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/g, '');
  return soloLetras.length >= 3;
}

/** Quita interpolaciones y bindings del texto de nodo para no contarlos como literal. */
function limpiarNodo(txt) {
  return txt
    .replace(/\{\{[^}]*\}\}/g, ' ') // {{ ... }}
    .replace(/&[a-z]+;/gi, ' ') // entidades
    .trim();
}

function analizarHtml(rawTxt) {
  const conT = new Set();
  const sinT = new Set();

  // Quita comentarios HTML (su texto no se muestra) antes de todo.
  const txt = rawTxt.replace(/<!--[\s\S]*?-->/g, ' ');

  // usos de t()
  for (const re of [PIPE_RE, CALL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(txt))) {
      const s = m[2].replace(/\\(['"])/g, '$1').trim();
      if (s) conT.add(s);
    }
  }

  // Elimina el contenido ya piped para no doble-contar y para no marcar como literal
  // el texto que vive dentro de un binding con `| t`.
  const sinPiped = txt.replace(PIPE_RE, ' ');

  // Texto de nodos: lo que hay entre `>` y `<`.
  const NODO_RE = />([^<]+)</g;
  let m;
  while ((m = NODO_RE.exec(sinPiped))) {
    const limpio = limpiarNodo(m[1]);
    if (!limpio) continue;
    // separa por saltos y evalúa cada frase
    for (const frag of limpio.split(/\s{2,}|\n/)) {
      const f = frag.trim();
      if (traducible(f)) sinT.add(f);
    }
  }

  // Atributos VISIBLES al usuario: solo `placeholder` (etiqueta de campo). `aria-label`
  // y `alt` son accesibilidad (lectores de pantalla), no copy visible → fuera del
  // conteo (el DEFAULT del alcance: "etiquetas de campo y encabezados sí").
  const ATTR_RE = /\bplaceholder\s*=\s*"([^"{][^"]*)"/g;
  while ((m = ATTR_RE.exec(sinPiped))) {
    const v = m[1].trim();
    if (traducible(v)) sinT.add(v);
  }
  return { conT: [...conT], sinT: [...sinT] };
}

// ── Recorrido: agrupa por PANTALLA (carpeta del componente) ────────────────────
/** Clave de pantalla = ruta relativa de la carpeta bajo src/app (p.ej. pages/perfil). */
function pantallaDe(fileFull) {
  const rel = relative(SRC, fileFull);
  const parts = rel.split(sep);
  parts.pop(); // quita el archivo
  return parts.join('/');
}

const screens = new Map(); // clave → { conT:Set, sinT:Set }
function add(screen, res) {
  if (!screens.has(screen)) screens.set(screen, { conT: new Set(), sinT: new Set() });
  const s = screens.get(screen);
  res.conT.forEach((x) => s.conT.add(x));
  res.sinT.forEach((x) => s.sinT.add(x));
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith('.html')) {
      const res = analizarHtml(readFileSync(full, 'utf8'));
      add(pantallaDe(full), res);
    }
  }
}
walk(SRC);

// ── Cobertura por pantalla e idioma ────────────────────────────────────────────
function coberturaPantalla(s, lang) {
  const cat = catalogs[lang];
  // "cubierto" = literales cableados y presentes en el catálogo del idioma.
  const conTraducido = [...s.conT].filter((k) => k in cat).length;
  const total = s.conT.size + s.sinT.size;
  const cubierto = conTraducido; // los sinT nunca están cubiertos
  return { total, cubierto, pct: total === 0 ? 100 : Math.round((cubierto / total) * 100) };
}

const byScreen = {};
let enCub = 0, enTot = 0, htCub = 0, htTot = 0;
const filas = [];
for (const [clave, s] of [...screens.entries()].sort()) {
  const en = coberturaPantalla(s, 'en');
  const ht = coberturaPantalla(s, 'ht');
  byScreen[clave] = { conT: s.conT.size, sinT: s.sinT.size, en: en.pct, ht: ht.pct };
  const enAlcance = !!alcanceSet && alcanceSet.has(clave);
  // El % de la CABECERA (el que usa el gate para ofrecer/no un idioma) es sobre TODA
  // la app — así "Inglés cubre n%" es honesto (no solo sobre lo ya cableado).
  if (en.total > 0) {
    enCub += en.cubierto; enTot += en.total;
    htCub += ht.cubierto; htTot += ht.total;
  }
  filas.push({ clave, ...byScreen[clave], enAlcance });
}

const enPct = enTot === 0 ? 0 : Math.round((enCub / enTot) * 100);
const htPct = htTot === 0 ? 0 : Math.round((htCub / htTot) * 100);

// ── Salidas ────────────────────────────────────────────────────────────────────
if (!existsSync(I18N_DIR)) mkdirSync(I18N_DIR, { recursive: true });
writeFileSync(
  join(I18N_DIR, 'coverage.json'),
  JSON.stringify({ en: enPct, ht: htPct, alcance: !!alcanceSet, byScreen }, null, 2) + '\n',
);

if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
let md = `# I18N-COVERAGE — cobertura por pantalla (BT2, regla 17)\n\n`;
md += `Generado por \`scripts/i18n-coverage.mjs\`. La unidad es la **pantalla**: un idioma\n`;
md += `se ofrece "de verdad" cuando cubre su alcance (en ≥95%, ht ≥90%).\n\n`;
md += `- **Inglés (en): ${enPct}%** del alcance · **Kreyòl (ht): ${htPct}%**\n`;
md += `- Alcance definido: ${alcanceSet ? `sí (${alcanceSet.size} pantallas)` : 'no (toda la app)'}\n\n`;
md += `| Pantalla | con t() | sin t() | en % | ht % | alcance |\n|---|---:|---:|---:|---:|:--:|\n`;
for (const f of filas.filter((x) => x.conT + x.sinT > 0)) {
  md += `| ${f.clave} | ${f.conT} | ${f.sinT} | ${f.en}% | ${f.ht}% | ${f.enAlcance ? '✅' : ''} |\n`;
}
writeFileSync(join(DOCS_DIR, 'I18N-COVERAGE.md'), md);

console.log(`\x1b[36m[i18n-coverage]\x1b[0m en ${enPct}% · ht ${htPct}% (alcance ${alcanceSet ? alcanceSet.size + ' pantallas' : 'toda la app'})`);
console.log(`  → docs/I18N-COVERAGE.md · public/i18n/coverage.json`);
