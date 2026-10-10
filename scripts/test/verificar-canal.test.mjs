// CL4 — test del candado de build (verificarCanalEnJs). Corre: npm run test:canal
import { verificarCanalEnJs } from '../lib/canal.mjs';

let fallos = 0;
const ok = (msg) => console.log(`✓ ${msg}`);
const fail = (msg) => { console.error(`✗ ${msg}`); fallos++; };

function esperaThrow(desc, fn) {
  try { fn(); fail(`${desc} — NO lanzó (debía abortar)`); }
  catch { ok(`${desc} — lanzó como se esperaba`); }
}
function esperaOk(desc, fn) {
  try { fn(); ok(`${desc} — pasó`); }
  catch (e) { fail(`${desc} — lanzó inesperadamente: ${e.message}`); }
}

// Bundle minificado FALSO con el bug (canal:"pwa" en un binario que debía ser 'apk').
const bundlePwa = 'x={production:!0,entorno:"prod",version:"2.46.0",canal:"pwa",appUrl:"u"}';
// Bundle correcto para 'apk'.
const bundleApk = 'x={production:!0,entorno:"prod",version:"2.46.0",canal:"apk",appUrl:"u"}';

esperaThrow('canal pwa cuando se espera apk', () => verificarCanalEnJs(bundlePwa, 'apk', '2.46.0'));
esperaOk('canal apk correcto', () => verificarCanalEnJs(bundleApk, 'apk', '2.46.0'));
esperaThrow('versión equivocada', () => verificarCanalEnJs(bundleApk, 'apk', '2.45.0'));
esperaThrow('sin canal en el bundle', () => verificarCanalEnJs('x={version:"2.46.0"}', 'apk', '2.46.0'));
esperaOk('canal play correcto', () => verificarCanalEnJs('x={version:"2.46.0",canal:"play"}', 'play', '2.46.0'));

if (fallos) { console.error(`\n🔴 ${fallos} fallo(s).`); process.exit(1); }
console.log('\n✓ candado canal: todos los casos OK');
