-- AY11 (rev) — Módulo "Ingeniería": concentra lo de ingenieros/producción. La
-- Solicitud de movimiento vive AQUÍ (no en Flota — no es buena práctica darle Flota
-- completo a un ingeniero). Crear ruta desde una solicitud = redirigir al wizard de
-- crear-ruta pre-llenado + vincular la ruta creada a la solicitud. Aditivo.
begin;

-- 1) Módulo 'ingenieria' para los roles de ingeniería/producción (crean/ven SUS
--    solicitudes) + los referentes (ven la bandeja completa y planifican). La RLS
--    de solicitudes_movimiento sigue acotando qué ve cada quien.
update sgc.roles
set modulos = (select array_agg(distinct m) from unnest(modulos || array['ingenieria']) m)
where codigo in (
  'admin', 'ingeniero_campo', 'ingeniero_oficina', 'jefe_ingenieros',
  'gerente_produccion', 'gerente_proyectos',
  'direccion', 'gerencia', 'jefe_flota', 'logistica', 'coord_compras', 'guarda_almacen'
);

-- 2) Vincular una ruta (creada por el wizard crear-ruta) a una solicitud: la marca
--    'planificada' y copia el chofer de la ruta. Solo referentes (server-side).
create or replace function sgc.vincular_solicitud_ruta(p_solicitud_id uuid, p_ruta_id uuid)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_cond uuid;
begin
  if not sgc.es_referente_movimiento() then
    raise exception 'No autorizado para planificar solicitudes.';
  end if;
  select conductor_id into v_cond from sgc.rutas where id = p_ruta_id;
  update sgc.solicitudes_movimiento
  set ruta_id = p_ruta_id,
      conductor_id = coalesce(v_cond, conductor_id),
      estado = case when estado = 'pendiente' then 'planificada' else estado end,
      updated_at = now()
  where id = p_solicitud_id;
end;
$$;
grant execute on function sgc.vincular_solicitud_ruta(uuid, uuid) to authenticated;

-- 3) Detalle ESTRUCTURADO de una solicitud (origen/destino con sus ids) para
--    pre-llenar el wizard de crear-ruta. Read-only, self/referente por RLS de la tabla.
create or replace function sgc.solicitud_movimiento_detalle(p_id uuid)
returns table (
  id uuid,
  proyecto_id uuid,
  proyecto text,
  que_se_mueve text,
  tipo_carga text,
  origen_tipo text,
  origen_texto text,
  origen_proyecto_id uuid,
  origen_bodega_id uuid,
  destino_tipo text,
  destino_texto text,
  destino_proyecto_id uuid,
  destino_bodega_id uuid,
  prioridad text,
  fecha_requerimiento date,
  notas text,
  estado text
)
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select s.id, s.proyecto_id,
         (select p.nombre from sgc.proyectos p where p.id = s.proyecto_id),
         s.que_se_mueve, s.tipo_carga,
         s.origen_tipo, s.origen_texto, s.origen_proyecto_id, s.origen_bodega_id,
         s.destino_tipo, s.destino_texto, s.destino_proyecto_id, s.destino_bodega_id,
         s.prioridad, s.fecha_requerimiento, s.notas, s.estado
  from sgc.solicitudes_movimiento s
  where s.id = p_id
    and (
      s.solicitante_id = auth.uid()
      or s.created_by = auth.uid()
      or sgc.es_referente_movimiento()
    );
$$;
grant execute on function sgc.solicitud_movimiento_detalle(uuid) to authenticated;

commit;
