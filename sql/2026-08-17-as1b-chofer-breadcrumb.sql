-- =============================================================================
-- AS1b / PROMPT-18 FASE 1 — Trazo EN VIVO por chofer (independiente de ruta)
-- =============================================================================
-- El trazado existente (`ruta_breadcrumb_vivo`) dibuja la línea SOLO de una ruta
-- formal. Con el tracking continuo (AS1) un chofer se mueve sin ruta → sin línea.
-- El jefe de flota pidió ver "la ruta que siguen (la línea que sigue las calles)".
-- Esta RPC devuelve el recorrido reciente de un chofer (últimas N min) sin importar
-- si hay ruta, para dibujar el breadcrumb en Seguimiento. Map-matching = v2 (cruda
-- primero). Misma forma jsonb que `ruta_breadcrumb_vivo` para reutilizar el cliente.
-- Aditivo. Gate: flota-elevado o el propio usuario.
-- =============================================================================
create or replace function sgc.chofer_breadcrumb_vivo(p_usuario_id uuid, p_minutos integer default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_admin boolean := sgc.is_admin() or sgc.es_flota_elevado();
begin
  if not (v_admin or p_usuario_id = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_array(lat, lng) order by capturado_en), '[]'::jsonb)
    from sgc.chofer_posiciones
    where usuario_id = p_usuario_id
      and capturado_en > now() - make_interval(mins => greatest(1, p_minutos))
  );
end;
$function$;

grant execute on function sgc.chofer_breadcrumb_vivo(uuid, integer) to authenticated;
