/**
 * CO · Data-fix VERSIONADO (regla 19) — corrige el changelog de **2.51.0** (móvil),
 * que salió registrado con el titulo/cambios VIEJOS de 2.50.0 por un olvido al
 * actualizar `CAMBIOS_CURADOS` en `scripts/release-apk.mjs` antes de este round.
 *
 *   node scripts/data-fixes/2026-10-16-co-corregir-changelog-2.51.0.mjs --env dev --yes
 *   node scripts/data-fixes/2026-10-16-co-corregir-changelog-2.51.0.mjs --env prod --yes
 *
 * Por qué un archivo en vez de volver a correr `apk:publish`: `sgc.registrar_version`
 * es "enriquecedor" (on conflict solo RELLENA titulo/cambios si están vacíos, nunca
 * sobrescribe). Como la fila 2.51.0 ya quedó con contenido (aunque errado), hace falta
 * un UPDATE directo de service_role — y regla 19 exige que ese write viva en un archivo
 * fechado y revisable.
 *
 * Qué hace:
 *   1) corrige `app_versiones.titulo`/`cambios` de 2.51.0 (plataforma='movil') al
 *      changelog real de esta ronda (CO: updater auto-repair, duplicados, Raykler
 *      autoaprobar, Apoyo, Web Push iPhone, Legal/Documentos, Compras-tec, Compa);
 *   2) corrige el `mensaje` de las notificaciones `tipo='version_publicada'` que ya
 *      se insertaron con el texto viejo (scoped por fecha: solo las de ESTE publish,
 *      16-oct, no toca el historial real de 2.50.0 del 13-oct).
 *
 * Lo que NO se puede corregir: el push FCM que ya salió a los tokens android con el
 * texto viejo (ya se entregó, no se puede recordar) y la notificación in-app de
 * Raykler (ya se insertó con el texto viejo en el momento del publish, se corrige
 * aquí mismo junto con las de android). Lo que sí importa — la pantalla de Novedades
 * (CO2), que lee `app_versiones` en vivo — queda bien desde este fix en adelante.
 */
import { resolverEnv } from '../lib/entorno.mjs';

const VERSION = '2.51.0';
const PLATAFORMA = 'movil';
const TITULO = 'La app se repara sola, avisos reales en iPhone, y nuevo Legal, Documentos y Compras tecnológicas';
const CAMBIOS = [
  { t: 'arreglo', m: 'Actualizaciones', d: 'La app ya no se queda "pegada" en una versión vieja: si algo falla al instalar una actualización, ahora se repara sola. También puedes tocar "Reparar la app" en Perfil › Acerca de si la ves rara.' },
  { t: 'arreglo', m: 'Combustible y conduces', d: 'Ya no se duplican los registros si tocas "Guardar" más de una vez o se te va la señal a mitad de camino (para Manolo y quien crea los conduces).' },
  { t: 'mejora', m: 'Requisiciones', d: 'Raykler y quien tenga el permiso ya puede aprobar sus propias requisiciones cuando corresponda, en vez de quedar bloqueado (para Raykler).' },
  { t: 'mejora', m: 'Apoyo de transporte', d: 'Ahora ves quién canceló o completó cada apoyo y por qué, y transporte puede cambiar el estado directo desde la ficha.' },
  { t: 'nuevo', m: 'Avisos en iPhone', d: 'Los iPhone ya pueden recibir avisos reales cuando llega algo nuevo, activándolos desde la cinta de notificaciones.' },
  { t: 'nuevo', m: 'Legal y Documentos', d: 'Nuevos módulos: expedientes y contratos en Legal, y generar documentos desde plantillas con vista previa y compartir por WhatsApp.' },
  { t: 'nuevo', m: 'Compras tecnológicas', d: 'El aprobador ya puede ver la cotización en PDF y aprobar o rechazar una compra directo desde el teléfono.' },
  { t: 'mejora', m: 'Compa', d: 'Los enlaces y PDF que te manda Compa ahora se ven y se abren bien, no como texto suelto (para Hector).' },
];
const MENSAJE_VIEJO = 'Ordenar el día de los choferes y mejoras en Mis trabajos y práctica — toca para actualizar.';
const MENSAJE_NUEVO = TITULO + ' — toca para actualizar.';
// Ventana del publish de HOY (16-oct) — para no tocar el historial real de 2.50.0 (13-oct).
const DESDE = '2026-10-16T00:00:00Z';

const env = await resolverEnv(process.argv.slice(2));
const URL = env.url, KEY = env.serviceKey;
if (!URL || !KEY) {
  console.error(`✗ Faltan SUPABASE_URL_${env.entorno.toUpperCase()} / SUPABASE_SERVICE_ROLE_KEY_${env.entorno.toUpperCase()}`);
  process.exit(1);
}
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Accept-Profile': 'sgc', 'Content-Profile': 'sgc', 'Content-Type': 'application/json' };
const api = (p, init = {}) => fetch(URL + '/rest/v1/' + p, { ...init, headers: { ...H, ...(init.headers || {}) } });

// 1) Corregir app_versiones.
const ver = await api(`app_versiones?plataforma=eq.${PLATAFORMA}&version=eq.${VERSION}`, {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ titulo: TITULO, cambios: CAMBIOS }),
});
if (!ver.ok) { console.error(`✗ no se pudo corregir app_versiones: ${ver.status} ${await ver.text()}`); process.exit(1); }
const verRows = await ver.json();
if (!verRows.length) { console.error(`✗ ${VERSION} (${PLATAFORMA}) no existe en ${env.entorno}.`); process.exit(1); }
console.log(`✓ app_versiones corregido: titulo="${verRows[0].titulo}" · ${verRows[0].cambios.length} cambios`);

// 2) Corregir las notificaciones ya insertadas con el mensaje viejo, SOLO las de hoy.
const notifs = await (await api(
  `notificaciones?select=id,usuario_id&tipo=eq.version_publicada&referencia_tipo=eq.version&mensaje=eq.${encodeURIComponent(MENSAJE_VIEJO)}&created_at=gte.${DESDE}`
)).json();
console.log(`• notificaciones de hoy con el mensaje viejo: ${Array.isArray(notifs) ? notifs.length : 0}`);
let corregidas = 0;
for (const n of notifs || []) {
  const r = await api(`notificaciones?id=eq.${n.id}`, { method: 'PATCH', body: JSON.stringify({ mensaje: MENSAJE_NUEVO }) });
  if (r.ok) corregidas++; else console.error(`  ✗ ${n.id}: ${r.status} ${await r.text()}`);
}
console.log(`✓ Listo. Notificaciones corregidas: ${corregidas}/${(notifs || []).length}.`);
console.log('  (El push FCM que ya salió a android con el texto viejo no se puede recordar; Novedades y el inbox ya muestran el texto correcto.)');
