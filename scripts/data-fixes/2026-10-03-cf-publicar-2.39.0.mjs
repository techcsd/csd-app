/**
 * CF · Data-fix VERSIONADO (regla 19) — publicar app **2.39.0** (móvil) en el entorno.
 *
 *   node scripts/data-fixes/2026-10-03-cf-publicar-2.39.0.mjs --env prod --yes
 *
 * Por qué un archivo en vez del RPC: `marcar_version_publicada` gatea por
 * `es_tecnologia()`, que el `service_role` NO cumple → se hace por UPDATE directo de
 * service_role, y regla 19 exige que ESE write viva en un archivo fechado y revisable
 * (no desde el scratchpad). Idempotente: re-ejecutar no cambia nada.
 *
 * Qué hace (plataforma='movil'):
 *   1) despublica la versión publicada actual (publicada=true → false),
 *   2) publica 2.39.0 (publicada=true, publicada_por=Tecnología, publicada_at=now()),
 *   3) NO toca `minima` (sigue 2.35.0). El trigger de versión-publicada dispara el push.
 */
import { resolverEnv } from '../lib/entorno.mjs';

const VERSION = '2.39.0';
const PLATAFORMA = 'movil';
// Tecnología (Xaviel) — autor de la publicación (auditoría publicada_por).
const TECNOLOGIA_EMAIL = 'tecnologia@constructorasd.com';
const TECNOLOGIA_ID_FALLBACK = '4b19cc4b-3dbe-40dc-8631-ef489cad0f45';

const env = await resolverEnv(process.argv.slice(2));
const URL = env.url;
const KEY = env.serviceKey;
if (!URL || !KEY) {
  console.error(`✗ Faltan SUPABASE_URL_${env.entorno.toUpperCase()} / SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`);
  process.exit(1);
}
const H = {
  apikey: KEY,
  Authorization: 'Bearer ' + KEY,
  'Accept-Profile': 'sgc',
  'Content-Profile': 'sgc',
  'Content-Type': 'application/json',
};
const api = (path, init = {}) => fetch(URL + '/rest/v1/' + path, { ...init, headers: { ...H, ...(init.headers || {}) } });

// 0) Resolver el usuario de Tecnología (auditoría). Fallback al id conocido.
let autorId = TECNOLOGIA_ID_FALLBACK;
try {
  const u = await (await api(`usuarios?select=id&email=ilike.${encodeURIComponent(TECNOLOGIA_EMAIL)}`)).json();
  if (Array.isArray(u) && u[0]?.id) autorId = u[0].id;
} catch { /* usa el fallback */ }

// 1) Verificar que la versión existe.
const existe = await (await api(`app_versiones?select=id,publicada,minima&plataforma=eq.${PLATAFORMA}&version=eq.${VERSION}`)).json();
if (!Array.isArray(existe) || !existe.length) {
  console.error(`✗ ${VERSION} (${PLATAFORMA}) no existe en app_versiones de ${env.entorno}. ¿Corriste apk:publish?`);
  process.exit(1);
}

// 2) Despublicar la(s) actualmente publicada(s) distintas de 2.39.0.
const despub = await api(`app_versiones?plataforma=eq.${PLATAFORMA}&publicada=eq.true&version=neq.${VERSION}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ publicada: false }),
});
const despubRows = await despub.json();
console.log(`• despublicadas: ${Array.isArray(despubRows) ? despubRows.map((r) => r.version).join(', ') || '(ninguna)' : despub.status}`);

// 3) Publicar 2.39.0 (idempotente).
const pub = await api(`app_versiones?plataforma=eq.${PLATAFORMA}&version=eq.${VERSION}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ publicada: true, publicada_por: autorId, publicada_at: new Date().toISOString() }),
});
if (!pub.ok) {
  console.error(`✗ no se pudo publicar ${VERSION}: ${pub.status} ${await pub.text()}`);
  process.exit(1);
}
console.log(`✓ publicada ${VERSION} (${PLATAFORMA}) · publicada_por=${autorId}`);

// 4) Verificar con el RPC oficial.
try {
  const vp = await (await api('rpc/version_publicada', { method: 'POST', body: JSON.stringify({ p_plataforma: PLATAFORMA }) })).json();
  console.log('• version_publicada():', JSON.stringify(vp));
} catch { /* best-effort */ }

// 5) Confirmar minima intacta.
const estado = await (await api(`app_versiones?select=version,publicada,minima&plataforma=eq.${PLATAFORMA}&order=created_at.desc&limit=4`)).json();
console.log('• estado:', JSON.stringify(estado));
console.log('\n✓ Listo. Mínima sin cambios (sigue 2.35.0).');
