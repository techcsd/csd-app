/**
 * CM7 · Data-fix VERSIONADO (regla 19) — registra las MISIONES de práctica de la
 * app (plataforma='app') en `sgc.practica_misiones`, para que `practica_guardar_intento`
 * acepte sus `mision_id` y "Mis resultados" las nombre.
 *
 *   node scripts/data-fixes/2026-10-12-cm7-seed-misiones-app.mjs --env dev --yes
 *
 * Idempotente (upsert por id). Los escenarios (objetivos/pasos/puntos) viven en el
 * CLIENTE (`core/practica/misiones-app.ts`); esta tabla solo registra id/título/rol
 * para el guardado del intento y el panel (web). F6a = el piloto 'app-combustible';
 * las demás (F6b) se añaden aquí con la misma forma.
 */
import { resolverEnv } from '../lib/entorno.mjs';

const CHOFER = ['chofer'];
const CAMPO = ['ingeniero_campo', 'ingeniero_oficina', 'capataz'];
const MISIONES = [
  // Piloto (intro, sin rol = todos).
  { id: 'app-combustible', plataforma: 'app', roles: [], titulo: 'Registrar combustible', version: 1, activa: true },
  // Chofer.
  { id: 'app-preuso', plataforma: 'app', roles: CHOFER, titulo: 'Pre-uso de vehículo', version: 1, activa: true },
  { id: 'app-uso-vehiculo', plataforma: 'app', roles: CHOFER, titulo: 'Tomar y soltar vehículo', version: 1, activa: true },
  { id: 'app-conduce', plataforma: 'app', roles: CHOFER, titulo: 'Entregar un conduce', version: 1, activa: true },
  { id: 'app-reporte-estado', plataforma: 'app', roles: CHOFER, titulo: 'Reportar estado del trabajo', version: 1, activa: true },
  // Ingeniero / capataz.
  { id: 'app-parte-diario', plataforma: 'app', roles: CAMPO, titulo: 'Parte diario de bitácora', version: 1, activa: true },
  { id: 'app-pedir-material', plataforma: 'app', roles: CAMPO, titulo: 'Pedir material', version: 1, activa: true },
  { id: 'app-recibir-conduce', plataforma: 'app', roles: CAMPO, titulo: 'Recibir un conduce', version: 1, activa: true },
  { id: 'app-apoyo-transporte', plataforma: 'app', roles: CAMPO, titulo: 'Pedir apoyo de transporte', version: 1, activa: true },
];

const env = await resolverEnv(process.argv.slice(2));
const URL = env.url, KEY = env.serviceKey;
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
  Prefer: 'resolution=merge-duplicates,return=representation',
};

const res = await fetch(URL + '/rest/v1/practica_misiones?on_conflict=id', {
  method: 'POST',
  headers: H,
  body: JSON.stringify(MISIONES),
});
if (!res.ok) {
  console.error(`✗ upsert falló: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
console.log(`✓ ${Array.isArray(rows) ? rows.length : 0} misión(es) app registradas en ${env.entorno}:`,
  (Array.isArray(rows) ? rows.map((r) => r.id).join(', ') : ''));
