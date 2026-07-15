-- W4 — mis_rutas_hoy() ahora devuelve `notas` para que la app pueda mostrarlas
-- (el campo se capturaba en crear_ruta_app pero no se visualizaba en ningún lado).
-- Aditivo: solo agrega una clave al jsonb; no cambia la firma de la función.
create or replace function sgc.mis_rutas_hoy()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'sgc', 'pg_temp'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha, 'notas', r.notas) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  where r.fecha = current_date
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$function$;
