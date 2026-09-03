-- ════════════════════════════════════════════════════════════════════════════
--  BH6 — "Todas las tareas" para roles que asignan (gestión desde la app móvil)
--  ---------------------------------------------------------------------------
--  `mis_tareas_app` YA es estrictamente personal (asignada a mí / creada por mí /
--  admin) — se cerró el hueco de privacidad AY (cualquiera con el módulo veía TODO).
--  Consecuencia: un rol elevado (jefe que asigna) perdió la vista global. Esta RPC
--  la devuelve, GATEADA explícitamente (is_admin OR tiene_modulo('tareas')), espejo
--  de "Gestión de tareas" de la web. Permite ver las tareas por usuario y su estado.
--  Aditivo, backward-compatible. Misma forma de fila que mis_tareas_app.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function sgc.tareas_todas_app(
  p_incluir_completadas boolean default false,
  p_asignado_a uuid default null
)
returns table(
  id uuid, titulo text, descripcion text, estado text, prioridad text,
  asignado_a uuid, asignado_a_nombre text, asignado_por uuid, asignado_por_nombre text,
  proyecto_id uuid, proyecto_nombre text, fecha_limite date, fecha_completada date,
  created_at timestamptz, linked_tipo text, linked_id uuid, linked_params jsonb,
  auto_completada boolean
)
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  -- Gate explícito, misma regla que la web para "Gestión de tareas".
  if not (sgc.is_admin() or sgc.tiene_modulo('tareas')) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  return query
  select t.id, t.titulo, t.descripcion, t.estado, t.prioridad,
         t.asignado_a, ua.nombre, t.asignado_por, up.nombre,
         t.proyecto_id, p.nombre, t.fecha_limite, t.fecha_completada, t.created_at,
         t.linked_tipo, t.linked_id, t.linked_params, t.auto_completada
  from sgc.tareas t
  left join sgc.usuarios ua on ua.id = t.asignado_a
  left join sgc.usuarios up on up.id = t.asignado_por
  left join sgc.proyectos p on p.id = t.proyecto_id
  where (p_asignado_a is null or t.asignado_a = p_asignado_a)
    and (p_incluir_completadas or t.estado not in ('completada', 'cancelada'))
  order by ua.nombre nulls last,
    case t.estado when 'en_progreso' then 0 when 'pendiente' then 1 else 2 end,
    case t.prioridad when 'urgente' then 0 when 'alta' then 1 when 'media' then 2 else 3 end,
    t.fecha_limite nulls last,
    t.created_at desc;
end;
$function$;

grant execute on function sgc.tareas_todas_app(boolean, uuid) to authenticated;
