/**
 * DP-09 — codemod de `.ts`: envuelve con `this.i18n.t('…')` los literales de
 * toast/confirm/alert y (opcional, `--props`) de `mensaje:`/`error:`… DENTRO de una clase.
 * Dry-run por defecto; `--write` aplica. `--file <ruta>` acota a un archivo.
 *
 * NO toca: literales fuera de una clase (utilidades/constantes de módulo: se traducen
 * al mostrar), template literals con `${}`, ni arreglos/mapas constantes (DP-09).
 * Inyecta `private i18n = inject(I18nService)` si la clase aún no lo tiene.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src', 'app');
const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const PROPS = args.includes('--props');
const fIdx = args.indexOf('--file');
const SOLO = fIdx >= 0 ? args[fIdx + 1] : null;

const WL = new Set(JSON.parse(readFileSync(join(ROOT, 'scripts', 'i18n-whitelist.json'), 'utf8')));
const LETTER = /[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/;
const traducible = (s) => {
  const t = s.trim();
  if (t.length < 2 || !LETTER.test(t) || /[{}]/.test(t) || WL.has(t)) return false;
  return t.replace(/[^a-zA-ZáéíóúñÁÉÍÓÚÑüÜ]/g, '').length >= 3;
};

const TOAST = /\b((?:this\.)?(?:toast|snackbar)\.(?:error|success|warning|info|show|withAction|errorFrom)\(\s*)(['"`])((?:\\.|(?!\2).)*?)\2/g;
const CONFIRM = /\b((?:window\.)?(?:confirm|alert)\(\s*)(['"`])((?:\\.|(?!\2).)*?)\2/g;
const THROW = /(\bthrow new Error\(\s*)(['"`])((?:\\.|(?!\2).)*?)\2/g;
const SETMSG = /(\b\w*(?:error|Error|msg|Msg|mensaje|Mensaje|aviso|Aviso|hint|Hint)\w*\.set\(\s*)(['"`])((?:\\.|(?!\2).)*?)\2/g;
const PROP = /((?<!\.)\b(?:placeholder|mensaje|error|subtitulo|descripcion|hint|cta)\s*:\s*)(['"`])((?:\\.|(?!\2).)*?)\2/g;

const LABELACT = /((?<!\.)\blabel\s*:\s*)(['"])((?:\\.|(?!\2).)*?)\2/g;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (n.endsWith('.ts') && !n.endsWith('.spec.ts')) out.push(f);
  }
  return out;
}

/** Rangos de arreglos/mapas constantes (misma lógica que i18n-coverage). */
function spansCatalogo(ts) {
  const spans = [];
  let m;
  const reArr = /(?:=>|=|\breturn)\s*\[/g;
  while ((m = reArr.exec(ts))) {
    const ini = m.index + m[0].length - 1;
    let p = 1, i = ini + 1;
    while (i < ts.length && p > 0) { if (ts[i] === '[') p++; else if (ts[i] === ']') p--; i++; }
    spans.push([ini, i]);
  }
  const reRec = /:\s*Record</g;
  while ((m = reRec.exec(ts))) {
    let i = m.index + m[0].length, p = 1;
    while (i < ts.length && p > 0) { if (ts[i] === '<') p++; else if (ts[i] === '>') p--; i++; }
    const eq = ts.slice(i, i + 20).match(/^\s*=\s*\{/);
    if (!eq) continue;
    const ini = i + eq[0].length - 1;
    let p2 = 1, j = ini + 1;
    while (j < ts.length && p2 > 0) { if (ts[j] === '{') p2++; else if (ts[j] === '}') p2--; j++; }
    spans.push([ini, j]);
  }
  return spans;
}

let wrapped = 0;
let skipped = 0;
const tocados = [];
for (const file of walk(SRC)) {
  if (SOLO && relative(ROOT, file).split(sep).join('/') !== SOLO) continue;
  let s = readFileSync(file, 'utf8');
  const crlf = s.includes('\r\n');
  s = s.replace(/\r\n/g, '\n');
  const claseIdx = s.search(/\bclass\s+\w+/);
  if (claseIdx < 0) continue; // sin clase: utilidades → manual
  const spans = spansCatalogo(s);
  const dentro = (idx) => spans.some(([a, b]) => idx >= a && idx < b);
  let cambios = 0;
  const reemplazos = [];
  const procesa = (re, esProp) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(s))) {
      const idx = m.index;
      const lit = m[3];
      if (m[2] === '`' && lit.includes('${')) continue;
      if (!traducible(lit.replace(/\\(['"`])/g, '$1'))) continue;
      if (esProp && dentro(idx)) continue;
      if (idx < claseIdx) { skipped++; continue; }
      // ya envuelto (la llamada empieza con t( — el regex exige comilla justo tras el paréntesis, no aplica)
      reemplazos.push({ ini: idx + m[1].length, fin: idx + m[0].length, texto: `this.i18n.t(${m[2]}${lit}${m[2]})` });
    }
  };
  procesa(TOAST, false);
  procesa(CONFIRM, false);
  procesa(THROW, false);
  procesa(SETMSG, false);
  if (PROPS) procesa(PROP, true);
  // label de acciones de toast.withAction(...): se muestra tal cual → envolver.
  { LABELACT.lastIndex = 0; let m; while ((m = LABELACT.exec(s))) { if (!/withAction\(/.test(s.slice(Math.max(0, m.index - 260), m.index))) continue; if (!traducible(m[3])) continue; if (reemplazos.some((r) => r.ini === m.index + m[1].length)) continue; reemplazos.push({ ini: m.index + m[1].length, fin: m.index + m[0].length, texto: `this.i18n.t(${m[2]}${m[3]}${m[2]})` }); } }
  if (!reemplazos.length) continue;
  reemplazos.sort((a, b) => b.ini - a.ini);
  for (const r of reemplazos) {
    s = s.slice(0, r.ini) + r.texto + s.slice(r.fin);
    cambios++;
  }
  // inyección de i18n
  if (!/\bi18n\s*=\s*inject\(I18nService\)|\bi18n:\s*I18nService/.test(s)) {
    const cls = s.match(/export (?:abstract )?class\s+\w+[^{]*\{\n/);
    if (cls) {
      const pos = cls.index + cls[0].length;
      s = s.slice(0, pos) + `  private i18n = inject(I18nService);\n` + s.slice(pos);
    }
    let rel = relative(dirname(file), join(SRC, 'core', 'i18n', 'i18n.service')).split(sep).join('/');
    if (!rel.startsWith('.')) rel = './' + rel;
    if (!/import\s*\{[^}]*\bI18nService\b[^}]*\}\s*from/.test(s)) {
      const reImp = /^import[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm;
      let last = -1, mm;
      while ((mm = reImp.exec(s))) last = mm.index + mm[0].length;
      s = s.slice(0, last) + `\nimport { I18nService } from '${rel}';` + s.slice(last);
    }
    // inject de @angular/core
    const core = s.match(/import\s*\{([^}]*)\}\s*from\s*'@angular\/core';/);
    if (core && !/\binject\b/.test(core[1])) {
      s = s.replace(core[0], `import { ${core[1].trim()}, inject } from '@angular/core';`);
    } else if (!core) {
      s = `import { inject } from '@angular/core';\n` + s;
    }
  }
  wrapped += cambios;
  tocados.push([relative(ROOT, file).split(sep).join('/'), cambios]);
  if (WRITE) writeFileSync(file, crlf ? s.replace(/\n/g, '\r\n') : s);
}
console.log(`[i18n-wrap-ts] ${WRITE ? 'ESCRITO' : 'dry-run'} · envueltos ${wrapped} · fuera de clase (manual) ${skipped}`);
for (const [f, n] of tocados.sort((a, b) => b[1] - a[1])) console.log(`  ${f}: ${n}`);
