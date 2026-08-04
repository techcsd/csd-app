-- ============================================================================
-- AF29 (PROMPT-4, app) — Historial de conduces para la app móvil
-- Ronda 03/08/2026. Doc: TRANSPORTE-V2.md §1.4/§11 (matriz de visibilidad).
--
-- La app necesita un historial (no solo los de HOY sin entregar como
-- `mis_conduces_hoy`). Este RPC security-definer respeta la MATRIZ de visibilidad
-- (emisor/creador · chofer asignado · flota elevado · módulo inventario) y resuelve
-- los nombres de obra/bodega server-side (la RLS de sgc.proyectos deja fuera al
-- chofer — mismo gotcha que obras_con_bodega). Devuelve la FASE derivada (AF23) y
-- los ítems para pintar el detalle sin más viajes.
--
-- Aditivo, idempotente, read-only. NO cambia contratos existentes.
-- ============================================================================

create or replace function sgc.mis_conduces_historial(
  p_desde date default null,
  p_hasta date default null,
  p_proyecto_id uuid default null,
  p_limite int default 200
)
returns jsonb
language sql
stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(row_to_json(t) order by t.fecha desc, t.creado_en desc), '[]'::jsonb)
  from (
    select
      s.id,
      s.fecha,
      s.created_at                as creado_en,
      s.estado,
      sgc.conduce_fase(s.id)      as fase,
      sgc.conduce_tiene_alto_valor(s.id) as alto_valor,
      p.nombre                    as obra,
      s.proyecto_id,
      b.nombre                    as bodega,
      s.ruta_id,
      s.observaciones,
      s.entrega_receptor          as receptor,
      s.entregado_en,
      s.recibido_por is not null  as confirmado,
      s.recibido_en,
      s.firma_pendiente_usuario_id is not null as firma_pendiente,
      s.firma_pendiente_nombre    as firma_pendiente_nombre,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad,
          'alto_valor', coalesce(a.entrega_en_mano, false))), '[]'::jsonb)
        from sgc.detalle_salidas d
        join sgc.articulos a on a.id = d.articulo_id
        where d.salida_id = s.id
      ) as items
    from sgc.salidas_inventario s
    left join sgc.proyectos p on p.id = s.proyecto_id
    left join sgc.bodegas b on b.id = s.bodega_id
    where
      -- Matriz de visibilidad (§11): creador/emisor, chofer asignado, flota elevado, inventario.
      (
        s.creado_por = auth.uid()
        or exists (select 1 from sgc.conductores c where c.id = s.conductor_id and c.usuario_id = auth.uid())
        or sgc.es_flota_elevado()
        or sgc.tiene_modulo('inventario')
        or sgc.is_admin()
      )
      and ((not coalesce(s.es_prueba, false)) or sgc.is_admin())
      and (p_desde is null or s.fecha >= p_desde)
      and (p_hasta is null or s.fecha <= p_hasta)
      and (p_proyecto_id is null or s.proyecto_id = p_proyecto_id)
    order by s.fecha desc, s.created_at desc
    limit greatest(1, least(p_limite, 500))
  ) t;
$function$;

grant execute on function sgc.mis_conduces_historial(date, date, uuid, int) to authenticated, service_role;
