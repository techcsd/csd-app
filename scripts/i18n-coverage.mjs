/**
 * BT2 (regla 17) + DP-07 — cobertura de i18n POR PANTALLA, HTML **y `.ts`**.
 * La unidad es la pantalla (carpeta del componente bajo src/app). Por pantalla cuenta:
 *   · con t()  = textos visibles ya cableados (`| t`, `i18n.t('…')`, catálogos de
 *                etiquetas constantes que se traducen al mostrar) y presentes en el
 *                catálogo del idioma (en/ht).
 *   · sin t()  = literales en español visibles al usuario que NO pasan por t():
 *                texto de nodo + `placeholder` en HTML; en `.ts`: toasts, confirm/alert,
 *                `mensaje`/`error`/`label`/`titulo`/`placeholder`… (DP-07c).
 *
 * Cobertura = conT-en-catálogo / (conT + sinT), sobre TODAS las pantallas (DP-07d: el
 * alcance es toda la app). Un idioma solo se ofrece sin «beta» cuando el número medido
 * llega a 100 % (DP-12) — el estado NUNCA se pone a mano.
 *
 * Salidas (generadas, no editar a mano):
 *   · docs/I18N-COVERAGE.md        — reporte por pantalla.
 *   · public/i18n/coverage.json    — { en, ht, totales, byScreen } que LEE la app.
 *   · src/app/core/i18n/alcance.json — TODAS las pantallas; `enforce` se PRESERVA
 *     (se activa por lote a medida que una pantalla llega a 100 %).
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
const alcancePrev = existsSync(ALCANCE_P) ? JSON.parse(readFileSync(ALCANCE_P, 'utf8')) : { pantallas: {} };
// Formato viejo (arreglo de nombres) → mapa { pantalla: { enforce:true } }.
const enforcePrev = new Map();
if (Array.isArray(alcancePrev.pantallas)) alcancePrev.pantallas.forEach((p) => enforcePrev.set(p, true));
else Object.entries(alcancePrev.pantallas ?? {}).forEach(([k, v]) => enforcePrev.set(k, !!v?.enforce));

// ── Detección de literales / usos de t() ───────────────────────────────────────
const PIPE_RE = /(['"`])((?:\\.|(?!\1).)*?)\1\s*\|\s*t\b/g;
const CALL_RE = /\.t\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const LETTER = /[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/;

/** ¿Este texto visible es candidato a traducción? (tiene palabras, no es var/número/emoji). */
function traducible(s) {
  const t = s.trim();
  if (t.length < 2) return false;
  if (!LETTER.test(t)) return false;
  if (/[{}]/.test(t)) return false;
  if (/@(if|else|for|empty|switch|case|default|defer|placeholder|loading|error)\b/.test(t)) return false;
  if (/^[@#*(\[]/.test(t)) return false;
  if (whitelist.has(t)) return false;
  // Identificadores técnicos (clases CSS, claves de módulo `flota.vehiculos`, `suceso_equipo`).
  if (/^[a-z0-9_.:\-\/]+$/.test(t)) return false;
  if (/^[MLHVCQZmlhvcqz0-9 .,\-]+$/.test(t)) return false; // trazos SVG (path d="…")
  const soloLetras = t.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/g, '');
  return soloLetras.length >= 3;
}

function limpiarNodo(txt) {
  return txt
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .trim();
}

function unesc(s) {
  return s.replace(/\\(['"`])/g, '$1').trim();
}

function analizarHtml(rawTxt) {
  const conT = new Set();
  const sinT = new Set();
  let txt = rawTxt.replace(/<!--[\s\S]*?-->/g, ' ');
  // Un `>`/`<` DENTRO de un valor de atributo (`[disabled]="a >= b"`, `(click)="x > 0"`)
  // o de la condición de un @if/@for no delimita etiqueta: se neutraliza para no
  // contarlo como texto de nodo.
  txt = txt.replace(/="[^"]*[<>][^"]*"/g, (m) => '="' + ' '.repeat(m.length - 3) + '"');
  txt = txt.replace(/@(?:if|else if|for|switch)\s*\((?:[^()]|\([^()]*\))*\)/g, (m) => (/[<>]/.test(m) ? ' '.repeat(m.length) : m));
  for (const re of [PIPE_RE, CALL_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(txt))) {
      const s = unesc(m[2]);
      if (s) conT.add(s);
    }
  }
  const sinPiped = txt.replace(PIPE_RE, ' ');
  const NODO_RE = />([^<]+)</g;
  let m;
  while ((m = NODO_RE.exec(sinPiped))) {
    const limpio = limpiarNodo(m[1]);
    if (!limpio) continue;
    for (const frag of limpio.split(/\s{2,}|\n/)) {
      const f = frag.trim();
      if (traducible(f)) sinT.add(f);
    }
  }
  // Solo `placeholder` es copy visible; aria-label/alt son accesibilidad (fuera del conteo).
  const ATTR_RE = /\bplaceholder\s*=\s*"([^"{][^"]*)"/g;
  while ((m = ATTR_RE.exec(sinPiped))) {
    const v = m[1].trim();
    if (traducible(v)) sinT.add(v);
  }
  return { conT: [...conT], sinT: [...sinT] };
}

// ── .ts (DP-07c) ───────────────────────────────────────────────────────────────
// Llamadas con literal directo: toast.error('…'), toast.show('…'), confirm('…')…
const TS_TOAST_LIT = /\b(?:toast|snackbar)\.(?:error|success|warning|info|show|withAction|errorFrom)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_CONFIRM_LIT = /\b(?:window\.)?(?:confirm|alert)\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
// (?<!\.) evita `x.mensaje : y` (acceso a propiedad) vs. clave de objeto `mensaje: 'y'`.
const TS_PROP_LIT = /(?<![.'"`\w])\b(placeholder|label|titulo|texto|sub|mensaje|error|subtitulo|descripcion|hint|cta|title|text|body|subtitle|desc|caption)\s*:\s*(['"`])((?:\\.|(?!\2).)*?)\2/g;
const TS_THROW_LIT = /\bthrow new Error\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_SET_LIT = /\b\w*(?:error|Error|msg|Msg|mensaje|Mensaje|aviso|Aviso|hint|Hint)\w*\.set\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
const TS_RETURN_LIT = /\breturn\s+(['"`])([A-ZÁÉÍÓÚ¿¡](?:\\.|(?!\1).)*?)\1\s*;/g;
// Props de ETIQUETA: se declaran en español y se traducen al MOSTRAR (`| t`) → cuentan como
// clave de catálogo requerida, no como «sin t()». El resto (mensaje/error/…) se muestra tal cual.
const PROP_ETIQUETA = new Set(['label', 'titulo', 'texto', 'sub', 'cta', 'title', 'text', 'body', 'subtitle', 'desc', 'caption']);

/** Rangos [ini,fin) de arreglos/mapas constantes `= [...]`, `Record<…> = {…}` (DP-09:
 *  se declaran en español y se traducen al MOSTRAR; sus literales deben EXISTIR en el
 *  catálogo pero no cuentan como «sin t()»). */
function spansCatalogo(ts) {
  const spans = [];
  let m;
  const reArr = /(?:=>|=|\breturn|:)\s*\[/g;
  while ((m = reArr.exec(ts))) {
    const ini = m.index + m[0].length - 1;
    let prof = 1;
    let i = ini + 1;
    while (i < ts.length && prof > 0) {
      if (ts[i] === '[') prof++;
      else if (ts[i] === ']') prof--;
      i++;
    }
    spans.push([ini, i]);
  }
  const reRec = /:\s*Record</g;
  while ((m = reRec.exec(ts))) {
    let i = m.index + m[0].length;
    let prof = 1;
    while (i < ts.length && prof > 0) {
      if (ts[i] === '<') prof++;
      else if (ts[i] === '>') prof--;
      i++;
    }
    const eq = ts.slice(i, i + 20).match(/^\s*=\s*\{/);
    if (!eq) continue;
    const ini = i + eq[0].length - 1;
    let p2 = 1;
    let j = ini + 1;
    while (j < ts.length && p2 > 0) {
      if (ts[j] === '{') p2++;
      else if (ts[j] === '}') p2--;
      j++;
    }
    spans.push([ini, j, 'rec']);
  }
  return spans;
}
const dentro = (spans, idx) => spans.some(([s, e]) => idx >= s && idx < e);

function analizarTs(raw) {
  // Quita comentarios (// y /* */) para no contar texto que no se muestra.
  const ts = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  const conT = new Set();
  const sinT = new Set();
  let m;
  for (const re of [CALL_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(ts))) {
      const s = unesc(m[2]);
      if (s) conT.add(s);
    }
  }
  const spans = spansCatalogo(ts);
  // Mapas `Record<K,string> = { clave: 'Etiqueta' }`: cada VALOR es una clave de catálogo
  // (se traduce al mostrar, DP-09) aunque la propiedad no se llame label/titulo.
  for (const [ini, fin, tipo] of spans) {
    if (tipo !== 'rec') continue;
    const VAL = /:\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
    const cuerpo = ts.slice(ini, fin);
    let mv;
    while ((mv = VAL.exec(cuerpo))) {
      const s = unesc(mv[2]).replace(/\s+/g, ' ');
      if (!(mv[1] === '`' && s.includes('${')) && traducible(s)) conT.add(s);
    }
  }
  const add = (lit, tpl) => {
    if (tpl && lit.includes('${')) return; // template con datos → no es copy plano
    const s = unesc(lit).replace(/\s+/g, ' ');
    if (traducible(s)) sinT.add(s);
  };
  TS_TOAST_LIT.lastIndex = 0;
  while ((m = TS_TOAST_LIT.exec(ts))) add(m[2], m[1] === '`');
  TS_CONFIRM_LIT.lastIndex = 0;
  while ((m = TS_CONFIRM_LIT.exec(ts))) add(m[2], m[1] === '`');
  // throw new Error('…') y signals de mensaje (`this.error.set('…')`) → se muestran tal cual.
  TS_THROW_LIT.lastIndex = 0;
  while ((m = TS_THROW_LIT.exec(ts))) add(m[2], m[1] === '`');
  TS_SET_LIT.lastIndex = 0;
  while ((m = TS_SET_LIT.exec(ts))) add(m[2], m[1] === '`');
  // `return 'Frase'` en funciones de etiqueta/mensaje: clave de catálogo (se traduce al mostrar).
  TS_RETURN_LIT.lastIndex = 0;
  while ((m = TS_RETURN_LIT.exec(ts))) {
    const s = unesc(m[2]).replace(/\s+/g, ' ');
    if (!(m[1] === '`' && s.includes('${')) && traducible(s)) conT.add(s);
  }
  TS_PROP_LIT.lastIndex = 0;
  while ((m = TS_PROP_LIT.exec(ts))) {
    if (dentro(spans, m.index) || PROP_ETIQUETA.has(m[1])) {
      // catálogo constante / etiqueta: se traduce al mostrar → debe existir en el catálogo
      const s = unesc(m[3]).replace(/\s+/g, ' ');
      if (!(m[2] === '`' && s.includes('${')) && traducible(s)) conT.add(s);
      continue;
    }
    add(m[3], m[2] === '`');
  }
  return { conT: [...conT], sinT: [...sinT] };
}

// ── Recorrido: agrupa por PANTALLA (carpeta del componente) ────────────────────
function pantallaDe(fileFull) {
  const rel = relative(SRC, fileFull);
  const parts = rel.split(sep);
  parts.pop();
  return parts.join('/');
}

const screens = new Map();
function add(screen, res, fuente) {
  if (!screens.has(screen)) screens.set(screen, { conT: new Set(), sinT: new Set(), sinTArchivos: new Map(), tsSin: 0 });
  const s = screens.get(screen);
  res.conT.forEach((x) => s.conT.add(x));
  res.sinT.forEach((x) => {
    s.sinT.add(x);
    if (!s.sinTArchivos.has(fuente)) s.sinTArchivos.set(fuente, []);
    s.sinTArchivos.get(fuente).push(x);
  });
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith('.html')) add(pantallaDe(full), analizarHtml(readFileSync(full, 'utf8')), relative(ROOT, full).split(sep).join('/'));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) add(pantallaDe(full), analizarTs(readFileSync(full, 'utf8')), relative(ROOT, full).split(sep).join('/'));
  }
}
walk(SRC);

// ── Cobertura por pantalla e idioma ────────────────────────────────────────────
function cobertura(s, lang) {
  const cat = catalogs[lang];
  const faltan = [...s.conT].filter((k) => !(k in cat));
  const cubierto = s.conT.size - faltan.length;
  const total = s.conT.size + s.sinT.size;
  return { total, cubierto, falta: faltan.length, pct: total === 0 ? 100 : Math.round((cubierto / total) * 100) };
}

const byScreen = {};
let enCub = 0, enTot = 0, htCub = 0, htTot = 0, conTTot = 0, sinTTot = 0;
const filas = [];
for (const [clave, s] of [...screens.entries()].sort()) {
  const en = cobertura(s, 'en');
  const ht = cobertura(s, 'ht');
  byScreen[clave] = { conT: s.conT.size, sinT: s.sinT.size, faltaEn: en.falta, faltaHt: ht.falta, en: en.pct, ht: ht.pct };
  if (en.total > 0) {
    enCub += en.cubierto; enTot += en.total;
    htCub += ht.cubierto; htTot += ht.total;
    conTTot += s.conT.size; sinTTot += s.sinT.size;
  }
  filas.push({ clave, ...byScreen[clave], enforce: enforcePrev.get(clave) === true, archivos: s.sinTArchivos });
}
// Porcentaje con 2 decimales truncados hacia abajo: «100» solo si de verdad es 100 exacto.
const pct = (c, t) => (t === 0 ? 0 : Math.floor((c / t) * 10000) / 100);
const enPct = pct(enCub, enTot);
const htPct = pct(htCub, htTot);

// ── Salidas ────────────────────────────────────────────────────────────────────
if (!existsSync(I18N_DIR)) mkdirSync(I18N_DIR, { recursive: true });
writeFileSync(
  join(I18N_DIR, 'coverage.json'),
  JSON.stringify({ en: enPct, ht: htPct, literales: enTot, conT: conTTot, sinT: sinTTot, pantallas: filas.length, byScreen }, null, 2) + '\n',
);

if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
let md = `# I18N-COVERAGE — cobertura por pantalla (BT2/DP-07)\n\n`;
md += `Generado por \`scripts/i18n-coverage.mjs\` (HTML + \`.ts\`). La unidad es la **pantalla**; el alcance es **toda la app**.\n`;
md += `Un idioma se ofrece sin «beta» solo cuando el número medido llega a 100 % (DP-12).\n\n`;
md += `- **English: ${enPct}%** · **Kreyòl: ${htPct}%** (${enTot} textos medidos en ${filas.length} pantallas)\n`;
md += `- Textos con t(): ${conTTot} · sin t(): ${sinTTot}\n`;
md += `- Pantallas \`enforce:true\`: ${filas.filter((f) => f.enforce).length} de ${filas.length}\n\n`;
md += `| Pantalla | con t() | sin t() | falta en | falta ht | en % | ht % | enforce |\n|---|---:|---:|---:|---:|---:|---:|:--:|\n`;
for (const f of filas.filter((x) => x.conT + x.sinT > 0)) {
  md += `| ${f.clave || '(raíz)'} | ${f.conT} | ${f.sinT} | ${f.faltaEn} | ${f.faltaHt} | ${f.en}% | ${f.ht}% | ${f.enforce ? '✅' : ''} |\n`;
}
writeFileSync(join(DOCS_DIR, 'I18N-COVERAGE.md'), md);

// Detalle de literales sin t() por archivo (para trabajar por lotes).
let det = `# Literales sin t() por archivo (generado por i18n-coverage)\n\n`;
for (const f of filas) {
  for (const [arch, lits] of f.archivos) {
    det += `## ${arch} (${lits.length})\n${lits.map((l) => `- ${l}`).join('\n')}\n\n`;
  }
}
writeFileSync(join(ROOT, 'scripts', 'i18n-sin-t.generated.md'), det);

// Claves usadas sin traducción por idioma (insumo de los lotes de traducción, DP-10).
{
  const usadas = new Set();
  for (const s of screens.values()) s.conT.forEach((k) => usadas.add(k));
  const faltantes = { usadas: usadas.size, en: [...usadas].filter((k) => !(k in catalogs.en)), ht: [...usadas].filter((k) => !(k in catalogs.ht)) };
  writeFileSync(join(ROOT, 'scripts', 'i18n-faltantes.generated.json'), JSON.stringify(faltantes, null, 1));
}

// alcance.json: TODAS las pantallas (DP-07d), enforce preservado.
const alcanceNuevo = {
  _doc: 'DP-07d/DP-13 — TODAS las pantallas medidas por scripts/i18n-coverage.mjs están en alcance. enforce:true rompe el build (verify-i18n) si la pantalla tiene literales (HTML o .ts) sin t() o claves sin traducir en en/ht. GENERADO en cada corrida; solo se edita a mano el campo enforce (se activa por lote).',
  pantallas: Object.fromEntries(filas.filter((f) => f.conT + f.sinT > 0).map((f) => [f.clave, { enforce: f.enforce }])),
};
writeFileSync(ALCANCE_P, JSON.stringify(alcanceNuevo, null, 2) + '\n');

console.log(`\x1b[36m[i18n-coverage]\x1b[0m en ${enPct}% · ht ${htPct}% · ${enTot} textos (${conTTot} con t(), ${sinTTot} sin) · ${filas.length} pantallas`);
console.log(`  → docs/I18N-COVERAGE.md · public/i18n/coverage.json · alcance.json`);
