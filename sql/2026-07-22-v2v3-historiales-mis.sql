-- ACT.6 (ronda 7) — V2 + V3: historiales "de lo mío" para la app móvil.
-- Expone listas navegables (no solo contadores) del usuario autenticado, con
-- scoping explícito por identidad (auth.uid()) — SECURITY DEFINER + search_path
-- fijo, mismo patrón que sgc.mis_conductor_ids()/mis_pendientes_transporte().
-- Aditivo y retrocompatible: solo AÑADE funciones nuevas; no toca nada existente.
--
-- Firmas (para PROMPT-15 FASE 4):
--   sgc.mis_reportes_semanales(p_desde date default null, p_hasta date default null) -> jsonb
--   sgc.mis_preusos(p_desde date default null, p_hasta date default null)            -> jsonb
--   sgc.mis_echadas(p_desde date default null, p_hasta date default null)            -> jsonb
--   sgc.mis_rutas_creadas(p_desde date default null, p_hasta date default null)      -> jsonb
-- Rango por defecto: últimos 90 días (para "ver más" la app pasa un p_desde menor).
-- Todas devuelven jsonb (array de objetos; '[]' si vacío), como mis_rutas_hoy.
-- Excluyen registros marcados es_prueba=true (fuera del flujo real).

-- ── V2.a — Reportes semanales del usuario ──────────────────────────────────
-- Semanal = checklist cuya plantilla tiene frecuencia='semanal'. Se atribuye al
-- usuario por su conductor (mis_conductor_ids) o por creado_por.
create or replace function sgc.mis_reportes_semanales(
  p_desde date default null,
  p_hasta date default null
) returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by x.fecha desc, x.created_at desc), '[]'::jsonb)
  from (
    select c.id, c.fecha, c.vehiculo_id, v.placa, v.marca, v.modelo,
           c.resultado, c.kilometraje, c.nivel_combustible,
           c.tiene_criticos, c.created_at
    from sgc.checklists_vehiculo c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    join sgc.checklist_plantillas p on p.id = c.plantilla_id
    where p.frecuencia = 'semanal'
      and (c.conductor_id in (select sgc.mis_conductor_ids()) or c.creado_por = auth.uid())
      and coalesce(c.es_prueba, false) = false
      and c.fecha >= coalesce(p_desde, current_date - 90)
      and c.fecha <= coalesce(p_hasta, current_date)
  ) x;
$$;

-- ── V2.b — Pre-usos del usuario ────────────────────────────────────────────
create or replace function sgc.mis_preusos(
  p_desde date default null,
  p_hasta date default null
) returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by x.fecha desc, x.created_at desc), '[]'::jsonb)
  from (
    select c.id, c.fecha, c.vehiculo_id, v.placa, v.marca, v.modelo,
           c.resultado, c.kilometraje, c.nivel_combustible,
           c.tiene_criticos, c.created_at
    from sgc.checklists_vehiculo c
    join sgc.vehiculos v on v.id = c.vehiculo_id
    where c.tipo = 'pre_uso'
      and (c.conductor_id in (select sgc.mis_conductor_ids()) or c.creado_por = auth.uid())
      and coalesce(c.es_prueba, false) = false
      and c.fecha >= coalesce(p_desde, current_date - 90)
      and c.fecha <= coalesce(p_hasta, current_date)
  ) x;
$$;

-- ── V2.c — Echadas de combustible del usuario ──────────────────────────────
-- registros_combustible no tiene creado_por → se atribuye por conductor.
create or replace function sgc.mis_echadas(
  p_desde date default null,
  p_hasta date default null
) returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by x.fecha desc, x.created_at desc), '[]'::jsonb)
  from (
    select r.id, r.fecha, r.vehiculo_id, v.placa, v.marca, v.modelo,
           r.galones, r.monto, r.kilometraje, r.km_recorridos,
           r.rendimiento_km_gal, r.costo_por_km, r.estacion,
           r.alerta_consumo, r.motivo_alerta, r.created_at
    from sgc.registros_combustible r
    join sgc.vehiculos v on v.id = r.vehiculo_id
    where r.conductor_id in (select sgc.mis_conductor_ids())
      and coalesce(r.es_prueba, false) = false
      and r.fecha >= coalesce(p_desde, current_date - 90)
      and r.fecha <= coalesce(p_hasta, current_date)
  ) x;
$$;

-- ── V3 — Rutas creadas/asignadas por el usuario (roles elevados) ───────────
-- El jefe de flota ve las rutas que él creó (creado_por = auth.uid()), con su
-- estado, conductor asignado y origen/destino. No requiere gate por rol: cada
-- quien ve solo lo que creó.
create or replace function sgc.mis_rutas_creadas(
  p_desde date default null,
  p_hasta date default null
) returns jsonb
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select coalesce(jsonb_agg(x order by x.fecha desc, x.created_at desc), '[]'::jsonb)
  from (
    select r.id, r.fecha, r.origen, r.destino, r.estado,
           r.vehiculo_id, v.placa,
           r.conductor_id, cond.nombre as conductor_nombre,
           r.km_estimado, r.created_at
    from sgc.rutas r
    left join sgc.vehiculos v on v.id = r.vehiculo_id
    left join sgc.conductores cond on cond.id = r.conductor_id
    where r.creado_por = auth.uid()
      and coalesce(r.es_prueba, false) = false
      and r.fecha >= coalesce(p_desde, current_date - 90)
      and r.fecha <= coalesce(p_hasta, current_date)
  ) x;
$$;

-- Grants: mismas que el resto de RPC de la app (JWT authenticated).
grant execute on function sgc.mis_reportes_semanales(date, date) to authenticated;
grant execute on function sgc.mis_preusos(date, date) to authenticated;
grant execute on function sgc.mis_echadas(date, date) to authenticated;
grant execute on function sgc.mis_rutas_creadas(date, date) to authenticated;

-- PostgREST: recargar el schema cache para exponer las funciones nuevas.
notify pgrst, 'reload schema';
