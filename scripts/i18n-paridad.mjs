/**
 * DP-10 — paridad web↔app (SOLO REPORTE, nunca falla). Compara las claves comunes de
 * public/i18n/{en,ht}.json con las del repo SGC y lista las traducciones divergentes
 * para unificar criterio. Ruta del SGC: env SGC_I18N_DIR o el default de esta máquina.
 * Salida: docs/I18N-PARIDAD.md
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SGC = process.env.SGC_I18N_DIR || 'C:/Users/xavie/Desktop/X Dev/dev/SGC/public/i18n';
if (!existsSync(join(SGC, 'en.json'))) {
  console.log(`[i18n-paridad] repo SGC no accesible en ${SGC} — nada que comparar.`);
  process.exit(0);
}
let md = '# I18N-PARIDAD — traducciones divergentes web ↔ app (generado)\n\n';
md += 'Claves presentes en ambos catálogos cuya traducción difiere. Solo informativo (`scripts/i18n-paridad.mjs`).\n\n';
for (const lang of ['en', 'ht']) {
  const app = JSON.parse(readFileSync(join(ROOT, 'public', 'i18n', `${lang}.json`), 'utf8'));
  const sgc = JSON.parse(readFileSync(join(SGC, `${lang}.json`), 'utf8'));
  const comunes = Object.keys(app).filter((k) => k in sgc);
  const dif = comunes.filter((k) => app[k] !== sgc[k]);
  md += `## ${lang} — ${comunes.length} claves comunes, ${dif.length} divergentes\n\n`;
  if (dif.length) md += '| Clave (es) | App | SGC |\n|---|---|---|\n';
  for (const k of dif.slice(0, 300)) md += `| ${k.replace(/\|/g, '\\|')} | ${app[k].replace(/\|/g, '\\|')} | ${sgc[k].replace(/\|/g, '\\|')} |\n`;
  if (dif.length > 300) md += `\n… y ${dif.length - 300} más.\n`;
  md += '\n';
  console.log(`[i18n-paridad] ${lang}: ${comunes.length} comunes, ${dif.length} divergentes`);
}
writeFileSync(join(ROOT, 'docs', 'I18N-PARIDAD.md'), md);
