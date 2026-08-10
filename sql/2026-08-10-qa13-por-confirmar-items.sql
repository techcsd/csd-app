-- QA-13 (AJ15 / PROMPT-15) — El receptor puede registrar QUÉ y CUÁNTO faltó.
--
-- `conduce_confirmar_receptor` YA acepta y aplica `p_items` (reconcilia
-- cantidad_recibida por detalle). Lo que faltaba era que la bandeja del receptor
-- (`mis_entregas_por_confirmar`) devolviera el detalle de items para poder pintar
-- las cantidades editables cuando el receptor marca "Faltó algo". Este cambio es
-- aditivo: agrega la columna `items jsonb` al RETURNS TABLE. Como la función no
-- recibe argumentos, un DROP+CREATE no genera ambigüedad de overloads. Los callers
-- que ignoren la columna nueva siguen igual.

drop function if exists sgc.mis_entregas_por_confirmar();

create function sgc.mis_entregas_por_confirmar()
returns table(
  id uuid, fecha date, proyecto_id uuid, destino text, bodega text, estado text,
  fase text, entregado_en timestamp with time zone, entrega_foto_path text, items jsonb
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select s.id, s.fecha, s.proyecto_id, p.nombre, b.nombre, s.estado,
         sgc.conduce_fase(s.id), s.entregado_en, s.entrega_foto_path,
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'detalle_id', d.id,
                   'nombre', a.nombre,
                   'cantidad', d.cantidad,
                   'cantidad_recibida', d.cantidad_recibida
                 ) order by a.nombre), '[]'::jsonb)
            from sgc.detalle_salidas d
            join sgc.articulos a on a.id = d.articulo_id
           where d.salida_id = s.id) as items
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas   b on b.id = s.bodega_id
  where s.estado in ('entregado','entregado_incompleto')
    and s.recibido_por is null
    and not exists (select 1 from sgc.recepcion_confirmaciones rc
                    where rc.entidad_tipo in ('salida','conduce') and rc.entidad_id = s.id)
    and not (sgc.es_chofer_de_conduce(s.id) and not sgc.is_admin())  -- el que entregó no confirma
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('inventario')
      or exists (select 1 from sgc.receptores_de_destino(s.id) r where r.usuario_id = auth.uid())
    )
  order by s.entregado_en desc nulls last, s.created_at desc;
$function$;

grant execute on function sgc.mis_entregas_por_confirmar() to public;
grant execute on function sgc.mis_entregas_por_confirmar() to authenticated;
grant execute on function sgc.mis_entregas_por_confirmar() to service_role;
