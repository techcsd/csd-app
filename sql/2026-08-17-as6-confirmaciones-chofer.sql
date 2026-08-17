-- =============================================================================
-- AS6 / PROMPT-18 FASE 2 — El chofer ve en "Confirmaciones" las confirmaciones
-- de SUS entregas (no solo el receptor).
-- =============================================================================
-- `mis_confirmaciones` solo devolvía conduces donde `recibido_por = auth.uid()`
-- (el receptor). Se amplía (ADITIVO) para incluir también las entregas del chofer
-- (entregado_por = yo, o soy el conductor asignado) que YA fueron confirmadas por
-- el receptor (recibido_en not null). La firma/return type no cambian.
-- =============================================================================
create or replace function sgc.mis_confirmaciones(p_desde date default null, p_hasta date default null)
returns table (
  id uuid, fecha date, created_at timestamptz, proyecto_id uuid, destino text,
  bodega text, estado text, fase text, entregado_por uuid, entregado_por_nombre text,
  entregado_en timestamptz, recibido_en timestamptz, tiene_foto boolean,
  tiene_firma boolean, incompleta boolean
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select
    s.id, s.fecha, s.created_at,
    s.proyecto_id,
    coalesce(p.nombre, ba.nombre)::text as destino,
    b.nombre::text,
    s.estado, sgc.conduce_fase(s.id),
    s.entregado_por, ue.nombre, s.entregado_en,
    s.recibido_en,
    (s.recepcion_foto_path is not null),
    exists (select 1 from sgc.salida_firmas sf where sf.salida_id = s.id and sf.rol = 'receptor'),
    (s.estado = 'entregado_incompleto')
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   ba on ba.id = s.destino_almacen_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  left join sgc.usuarios ue on ue.id = s.entregado_por
  where (
      -- receptor (como antes)
      s.recibido_por = auth.uid()
      -- AS6 — chofer que entregó (o conductor asignado), YA confirmado por el receptor
      or (
        s.recibido_en is not null
        and (
          s.entregado_por = auth.uid()
          or exists (select 1 from sgc.conductores c
                     where c.id = s.conductor_id and c.usuario_id = auth.uid())
        )
      )
    )
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
  order by s.recibido_en desc nulls last, s.created_at desc
  limit 500;
$function$;

grant execute on function sgc.mis_confirmaciones(date, date) to authenticated;
