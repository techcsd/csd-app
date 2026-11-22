// scripts/verify-compat-ios.mjs — DU1/DU3 (PROMPT-151), prebuild.
//
// 1) DU1: `db.outbox.where('tipo_op')` está prohibido. `tipo_op` NO está indexado en
//    `outbox` → lanza "KeyPath tipo_op on object store outbox is not indexed" (60
//    crashes 20-nov-2026; dejó Conteo sin llegar a "ok"). Usar `outboxPorTipo(tipo)`
//    de core/db/app-db.ts. (`mis_registros` SÍ indexa tipo_op: ahí `.where` es válido.)
// 2) DU3: regex con lookbehind (`(?<=`, `(?<!`) prohibidos. Safari/iOS < 16.4 no los
//    parsea y un solo literal inválido tumba el chunk entero = app en blanco.
//
//   node scripts/verify-compat-ios.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(process.cwd(), 'src');
const REGLAS = [
  { re: /outbox\s*\.where\(\s*['"`]tipo_op['"`]\s*\)/, msg: "outbox.where('tipo_op') — usa outboxPorTipo() (tipo_op no está indexado)" },
  { re: /\(\?<[=!]/, msg: 'regex con lookbehind (?<= / ?<!) — rompe iOS < 16.4' },
];

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|js)$/.test(n) && !n.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const fallas = [];
for (const f of walk(SRC)) {
  const lineas = readFileSync(f, 'utf8').split(/\r?\n/);
  lineas.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comentarios
    for (const r of REGLAS) if (r.re.test(l)) fallas.push(`${relative(process.cwd(), f).split('\\').join('/')}:${i + 1}  ${r.msg}`);
  });
}
if (fallas.length) {
  console.error('verify-compat-ios: FALLA\n' + fallas.map((x) => '  ' + x).join('\n'));
  process.exit(1);
}
console.log('verify-compat-ios: OK');
