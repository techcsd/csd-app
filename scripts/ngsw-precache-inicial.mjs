// scripts/ngsw-precache-inicial.mjs — el service worker debe instalar de forma ATÓMICA todo lo que el arranque necesita.
//
// Problema (iPhone, prod, nov-2026): ngsw-config.json solo precachea index/main/polyfills/styles (~200 KB, ver CO1),
// pero `main-*.js` importa ESTÁTICAMENTE ~100 `chunk-*.js` (~1,2 MB) que quedan como `lazy`. Tras cada deploy, el primer
// arranque de la PWA los baja uno por uno por la red desde iOS: si tardan se dispara el guard de 8 s («timeout sin
// render») o, si el deploy ya cambió esos nombres, «script no cargó» → pantalla de rescate y el usuario tiene que
// pulsar «Reparar». (Telemetría: sgc.app_error_reports, mensajes «arranque: pantalla de rescate…».)
//
// Solución: después de `ng build`, calcular la clausura de imports estáticos de main-*.js y añadirla al grupo `app`
// (prefetch) de dist/…/ngsw.json con su sha1. ngsw activa una versión solo cuando TODO el grupo prefetch bajó y
// verificó → el build nuevo nunca arranca a medias. Los chunks de rutas (import()) siguen lazy.
//
// Uso: node scripts/ngsw-precache-inicial.mjs [--dist dist/csd-app/browser]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--dist');
const dist = i !== -1 ? join(ROOT, process.argv[i + 1]) : join(ROOT, 'dist', 'csd-app', 'browser');
const MAX_BYTES = 3 * 1024 * 1024; // si el arranque pesa más, algo se rompió en el split: no inflar el precache

const ngswPath = join(dist, 'ngsw.json');
if (!existsSync(ngswPath)) { console.log('ngsw-precache: no hay ngsw.json (build sin service worker) — nada que hacer.'); process.exit(0); }

const main = readdirSync(dist).find((f) => /^main-[A-Z0-9]+\.js$/.test(f));
if (!main) { console.error('🔴 ngsw-precache: no encontré main-*.js en dist'); process.exit(1); }

// Imports estáticos: `import{a}from"./x.js"`, `import"./x.js"`, `export*from"./x.js"`. Los `import("./x.js")` (con paréntesis) NO cuentan.
const ESTATICO = /(?:\bfrom|\bimport)\s*["'](\.\/[^"']+\.js)["']/g;
const vistos = new Set();
const pila = [main];
while (pila.length) {
  const f = pila.pop();
  const src = readFileSync(join(dist, f), 'utf8');
  for (const m of src.matchAll(ESTATICO)) {
    const n = m[1].slice(2);
    if (!vistos.has(n) && existsSync(join(dist, n))) { vistos.add(n); pila.push(n); }
  }
}
const chunks = [...vistos].sort();
const bytes = chunks.reduce((a, n) => a + readFileSync(join(dist, n)).length, 0);
if (bytes > MAX_BYTES) { console.error(`🔴 ngsw-precache: el arranque estático pesa ${(bytes / 1048576).toFixed(1)} MB (> 3 MB): revisa el code-splitting.`); process.exit(1); }

const ng = JSON.parse(readFileSync(ngswPath, 'utf8'));
const grupo = ng.assetGroups.find((g) => g.name === 'app' && g.installMode === 'prefetch');
if (!grupo) { console.error('🔴 ngsw-precache: no hay grupo app/prefetch en ngsw.json'); process.exit(1); }

let nuevos = 0;
for (const n of chunks) {
  const url = '/' + n;
  if (!grupo.urls.includes(url)) { grupo.urls.push(url); nuevos++; }
  ng.hashTable[url] = createHash('sha1').update(readFileSync(join(dist, n))).digest('hex');
}
// Re-hashear TODO lo que exista: en dev, patchDistForDev edita index.html/manifest DESPUÉS de que Angular calculó ngsw.json
// y el SW rechaza la versión por «hash mismatch». Esto deja la tabla siempre coherente con lo que se despliega.
let rehash = 0;
for (const url of Object.keys(ng.hashTable)) {
  const p = join(dist, url.slice(1));
  if (!existsSync(p)) continue;
  const h = createHash('sha1').update(readFileSync(p)).digest('hex');
  if (ng.hashTable[url] !== h) { ng.hashTable[url] = h; rehash++; }
}
grupo.urls.sort();
writeFileSync(ngswPath, JSON.stringify(ng));
console.log(`✓ ngsw-precache: ${nuevos} chunks de arranque (${(bytes / 1024).toFixed(0)} KB) añadidos al precache atómico de ${main}; grupo app = ${grupo.urls.length} archivos${rehash ? `; ${rehash} hashes corregidos (archivos editados tras ng build)` : ''}.`);
