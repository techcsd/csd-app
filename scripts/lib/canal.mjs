// scripts/lib/canal.mjs — CL4 (PROMPT-93 F1) — fuente ÚNICA del `environment.canal`
// que SOBREVIVE al `fileReplacements` de angular.json.
//
// El bug: build-env parcheaba `canal` dentro de environment.ts con un regex, pero
// `ng build --configuration production` REEMPLAZA environment.ts por
// environment.prod.ts (fileReplacements) → el parche se perdía y TODO APK/AAB
// terminaba con canal:"pwa" (UpdaterService solo recargaba en vez de instalar).
//
// La solución: environment.ts y environment.prod/dev.ts leen `canal` de
// canal.generated.ts (import). Ese archivo NO está en fileReplacements → su valor
// llega intacto al bundle. Es gitignored y lo escriben los scripts de build.
import { readFileSync, writeFileSync } from 'node:fs';

export const CANALES = ['play', 'apk', 'appstore', 'pwa'];
export const CANAL_PATH = 'src/environments/canal.generated.ts';

/** Escribe canal.generated.ts con el canal dado (normaliza a 'pwa' si es inválido).
 *  Devuelve el canal efectivo escrito. */
export function writeCanalGenerated(canal) {
  const c = CANALES.includes(canal) ? canal : 'pwa';
  const body =
    '// GENERADO por los scripts de build (build-env / build-apk / aab / gen-environment).\n' +
    '// NO editar a mano y NO versionar (gitignored). CL4: su valor SOBREVIVE al\n' +
    '// fileReplacements de angular.json (environment.ts → environment.prod.ts), por eso\n' +
    '// el canal real llega al bundle nativo en vez de quedar pisado a "pwa".\n' +
    `export const CANAL_BUILD = '${c}' as 'play' | 'apk' | 'appstore' | 'pwa';\n`;
  writeFileSync(CANAL_PATH, body, 'utf8');
  return c;
}

// Lookbehind (?<![\w$]) para no confundir con claves como `p_canal:"app"` (RPC) —
// solo la propiedad `canal` del objeto environment. Igual para `version`.
const RE_CANAL = /(?<![\w$])canal:\s*["']([^"']+)["']/g;
const RE_VERSION = /(?<![\w$])version:\s*["']([^"']+)["']/g;

/** CANDADO (puro, testeable): recibe el texto JS del bundle y verifica que el objeto
 *  `environment` traiga canal:"<expected>" Y version:"<expected>". Lanza si no. */
export function verificarCanalEnJs(jsText, expectedCanal, expectedVersion, meta = {}) {
  const fuente = meta.fuente ? ` (${meta.fuente})` : '';
  const canales = [...jsText.matchAll(RE_CANAL)].map((m) => m[1]);
  const versiones = [...jsText.matchAll(RE_VERSION)].map((m) => m[1]);
  const canalOk = canales.includes(expectedCanal);
  const versionOk = versiones.includes(expectedVersion);
  if (!canalOk || !versionOk) {
    throw new Error(
      `🔴 CANDADO DE BUILD${fuente}: el bundle NO trae canal:"${expectedCanal}" y/o version:"${expectedVersion}".\n` +
        `   canal(es) encontrado(s):   ${canales.length ? canales.map((c) => `"${c}"`).join(', ') : '(ninguno)'}\n` +
        `   version(es) encontrada(s): ${versiones.length ? versiones.map((v) => `"${v}"`).join(', ') : '(ninguna)'}\n` +
        `   CL4: un APK/AAB con canal "pwa" deja al UpdaterService solo recargando (nunca instala). Abortado.`,
    );
  }
  return { canal: expectedCanal, version: expectedVersion };
}

/** CANDADO a nivel de APK/AAB: abre el zip, concatena los .js de assets/public/ y
 *  delega en verificarCanalEnJs. Usa fflate (ya es dependencia). */
export async function verificarCanalEnZip(zipPath, expectedCanal, expectedVersion) {
  const { unzipSync, strFromU8 } = await import('fflate');
  const buf = readFileSync(zipPath);
  const files = unzipSync(new Uint8Array(buf), {
    // APK: assets/public/*.js  ·  AAB: base/assets/public/*.js
    filter: (f) => f.name.includes('assets/public/') && f.name.endsWith('.js'),
  });
  const nombres = Object.keys(files);
  if (!nombres.length) {
    throw new Error(`🔴 CANDADO DE BUILD (${zipPath}): no hallé JS en assets/public/ dentro del zip.`);
  }
  let jsAll = '';
  for (const n of nombres) jsAll += strFromU8(files[n]) + '\n';
  return verificarCanalEnJs(jsAll, expectedCanal, expectedVersion, { fuente: zipPath });
}
