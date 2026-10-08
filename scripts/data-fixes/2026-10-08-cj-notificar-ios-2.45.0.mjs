/**
 * CJ · Data-fix VERSIONADO (regla 19) — notificar a los usuarios de **iPhone (PWA)**
 * la publicación de app **2.45.0** (móvil).
 *
 *   node scripts/data-fixes/2026-10-08-cj-notificar-ios-2.45.0.mjs --env prod --yes
 *
 * Por qué: el trigger `trg_app_version_push` solo inserta la notificación in-app para
 * usuarios con **token android** (push FCM) y hace push a esos tokens. iOS no tiene
 * infraestructura de push (0 tokens), así que los iPhone (PWA) NO reciben nada — solo
 * verían el banner al abrir la app. Este fix les inserta la MISMA notificación in-app
 * (bandeja/campana) que recibieron los android, replicando exactamente la fila del
 * trigger. Idempotente (no duplica) y respeta `notif_permitida` (opt-outs).
 *
 * Audiencia: usuarios activos con `usuarios.plataforma ILIKE 'ios%'` (= 'ios-pwa').
 * NO toca a usuarios web ni a android (esos ya fueron notificados por el trigger).
 *
 * NOTA (hueco del padre): lo correcto a futuro es que `trg_app_version_push` también
 * inserte el inbox para usuarios con plataforma ios-pwa (sin token). Queda anotado en
 * sql-para-sgc/ para que el PADRE lo arregle permanentemente.
 */
import { resolverEnv } from '../lib/entorno.mjs';

const VERSION = '2.45.0';
const PLATAFORMA = 'movil';
const TIPO = 'version_publicada';

const env = await resolverEnv(process.argv.slice(2));
const URL = env.url, KEY = env.serviceKey;
if (!URL || !KEY) {
  console.error(`✗ Faltan SUPABASE_URL_${env.entorno.toUpperCase()} / SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`);
  process.exit(1);
}
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', 'Content-Type': 'application/json' };
const api = (p, init = {}) => fetch(URL + '/rest/v1/' + p, { ...init, headers: { ...H, ...(init.headers || {}) } });

// 1) Fila de la versión → título/mensaje IDÉNTICOS a los del trigger.
const ver = (await (await api(`app_versiones?select=version,titulo,publicada&plataforma=eq.${PLATAFORMA}&version=eq.${VERSION}`)).json())[0];
if (!ver) { console.error(`✗ ${VERSION} no existe en app_versiones (${env.entorno}).`); process.exit(1); }
if (!ver.publicada) { console.error(`✗ ${VERSION} no está publicada — no notifico.`); process.exit(1); }
const TITULO = 'Nueva actualización disponible';
const MENSAJE = (ver.titulo && ver.titulo.trim() ? ver.titulo.trim() : 'Versión ' + VERSION) + ' — toca para actualizar.';
console.log(`• versión ${VERSION} · mensaje: "${MENSAJE}"`);

// 2) Audiencia: usuarios activos con plataforma iOS (PWA).
const us = await (await api('usuarios?select=id,nombre,plataforma,es_prueba&activo=eq.true')).json();
const ios = us.filter((u) => /^ios/i.test(u.plataforma || '') && !u.es_prueba);
console.log(`• candidatos iPhone (plataforma ios*, no prueba): ${ios.length}`);

let insertadas = 0, saltadas = 0, bloqueadas = 0;
for (const u of ios) {
  // 2a) Respetar opt-out (igual que el trigger).
  const permitida = await (await api('rpc/notif_permitida', { method: 'POST', body: JSON.stringify({ p_usuario: u.id, p_tipo: TIPO }) })).json();
  if (permitida !== true) { bloqueadas++; console.log(`  – ${u.nombre}: opt-out (notif_permitida=false)`); continue; }
  // 2b) Idempotencia: ¿ya tiene esta notificación (mismo tipo + mensaje)?
  const existe = await (await api(`notificaciones?select=id&usuario_id=eq.${u.id}&tipo=eq.${TIPO}&mensaje=eq.${encodeURIComponent(MENSAJE)}&limit=1`)).json();
  if (Array.isArray(existe) && existe.length) { saltadas++; console.log(`  = ${u.nombre}: ya tenía la notificación`); continue; }
  // 2c) Insertar la MISMA fila que el trigger (ruta=null, referencia_tipo='version').
  const ins = await api('notificaciones', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ usuario_id: u.id, tipo: TIPO, titulo: TITULO, mensaje: MENSAJE, ruta: null, referencia_tipo: 'version' }),
  });
  if (!ins.ok) { console.error(`  ✗ ${u.nombre}: ${ins.status} ${await ins.text()}`); continue; }
  insertadas++; console.log(`  ✓ ${u.nombre}`);
}
console.log(`\n✓ Listo. Insertadas: ${insertadas} · ya tenían: ${saltadas} · opt-out: ${bloqueadas}.`);
console.log('  (iOS no tiene tokens push → es notificación in-app; también verán el banner de versión al abrir la PWA.)');
