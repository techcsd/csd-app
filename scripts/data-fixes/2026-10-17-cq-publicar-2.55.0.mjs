/**
 * CQ · Data-fix VERSIONADO (regla 19) — publicar app **2.55.0** (móvil) en el entorno.
 *
 *   node scripts/data-fixes/2026-10-17-cq-publicar-2.55.0.mjs --env dev --yes
 *   node scripts/data-fixes/2026-10-17-cq-publicar-2.55.0.mjs --env prod --yes
 *
 * Mismo patrón que 2026-10-16-cp-publicar-2.54.0.mjs: `marcar_version_publicada`
 * gatea por `es_tecnologia()` (el service_role no lo cumple) → UPDATE directo,
 * documentado aquí por regla 19. Idempotente.
 *
 * Qué hace (plataforma='movil'):
 *   1) despublica la versión publicada actual (publicada=true → false),
 *   2) publica 2.55.0 (publicada=true, publicada_por=Tecnología, publicada_at=now()),
 *   3) NO toca `minima` (sigue en lo que estaba — no se fuerza actualización; el
 *      teléfono de prueba sigue en 2.51.0-dev sin confirmar la actualización real,
 *      ver qa/release-2.55.0.md — forzar mínima ahora sería agravar ese riesgo).
 */
import { resolverEnv } from '../lib/entorno.mjs';

const VERSION = '2.55.0';
const PLATAFORMA = 'movil';
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

let autorId = TECNOLOGIA_ID_FALLBACK;
try {
  const u = await (await api(`usuarios?select=id&email=ilike.${encodeURIComponent(TECNOLOGIA_EMAIL)}`)).json();
  if (Array.isArray(u) && u[0]?.id) autorId = u[0].id;
} catch { /* usa el fallback */ }

const existe = await (await api(`app_versiones?select=id,publicada,minima&plataforma=eq.${PLATAFORMA}&version=eq.${VERSION}`)).json();
if (!Array.isArray(existe) || !existe.length) {
  console.error(`✗ ${VERSION} (${PLATAFORMA}) no existe en app_versiones de ${env.entorno}. ¿Corriste apk:publish?`);
  process.exit(1);
}

const despub = await api(`app_versiones?plataforma=eq.${PLATAFORMA}&publicada=eq.true&version=neq.${VERSION}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ publicada: false }),
});
const despubRows = await despub.json();
console.log(`• despublicadas: ${Array.isArray(despubRows) ? despubRows.map((r) => r.version).join(', ') || '(ninguna)' : despub.status}`);

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

const estado = await (await api(`app_versiones?select=version,publicada,minima&plataforma=eq.${PLATAFORMA}&order=created_at.desc&limit=4`)).json();
console.log('• estado:', JSON.stringify(estado));
console.log('\n✓ Listo. Mínima sin cambios.');
