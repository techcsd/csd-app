-- W2 + W3 — crear_bitacora_app canónico.
-- PROMPT-9 ya extendió crear_bitacora_app con p_hubo_equipos + p_equipos_alquilados
-- (tabla sgc.bitacora_equipos_alquilados). Esta migración:
--   1) elimina la sobrecarga redundante de 23 args (sin p_hubo_equipos) que quedó
--      de un intento previo, para que PostgREST no vea 2 funciones ambiguas;
--   2) reemplaza la función por UNA sola que además acepta los campos de PARIDAD
--      con la web (W3) que hoy solo escribía el form web por insert directo:
--      bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo (parte_diario),
--      incidente_subcontratista (incidente) y visita_* (tipo 'visita').
-- Todo aditivo y retrocompatible: los params nuevos tienen default, así que las
-- versiones viejas de la app que llaman con menos args siguen funcionando.

-- 1) sobrecarga redundante (23 args, sin p_hubo_equipos)
drop function if exists sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz, boolean, text, boolean, jsonb, jsonb
);
-- 2) versión PROMPT-9 (24 args) — la reemplazamos por la canónica de abajo
drop function if exists sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz, boolean, text, boolean, jsonb, boolean, jsonb
);

create or replace function sgc.crear_bitacora_app(
  p_id uuid,
  p_proyecto_id uuid,
  p_fecha date,
  p_tipo text,
  p_comentarios text default null,
  p_personal_carpinteria smallint default 0,
  p_personal_acero smallint default 0,
  p_trabajadores_casa smallint default 0,
  p_otro_personal text default null,
  p_actividades jsonb default '[]'::jsonb,
  p_restricciones jsonb default '[]'::jsonb,
  p_incidente_tipo text default null,
  p_incidente_gravedad text default null,
  p_incidente_lesionados smallint default 0,
  p_incidente_descripcion text default null,
  p_incidente_acciones text default null,
  p_fotos jsonb default '[]'::jsonb,
  p_capturado_en timestamptz default now(),
  p_llovio boolean default null,
  p_lluvia_detalle text default null,
  p_hubo_migracion boolean default null,
  p_migracion_obreros jsonb default null,
  p_hubo_equipos boolean default null,
  p_equipos_alquilados jsonb default '[]'::jsonb,
  -- W3 — paridad con la web:
  p_bloque_entrepiso text default null,
  p_ingeniero_responsable text default null,
  p_hora_fin_trabajo time default null,
  p_incidente_subcontratista text default null,
  p_visita_tipo_visitante text default null,
  p_visita_nombre text default null,
  p_visita_organizacion text default null,
  p_visita_motivo text default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_eq  jsonb;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  if exists (select 1 from sgc.bitacoras where id = p_id) then
    return p_id;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    bloque_entrepiso, ingeniero_responsable, hora_fin_trabajo,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    visita_tipo_visitante, visita_nombre, visita_organizacion, visita_motivo,
    incidente_tipo, incidente_gravedad, incidente_subcontratista, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros,
    hubo_equipos_alquilados
  ) values (
    p_id, v_uid, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    nullif(trim(p_bloque_entrepiso),''), nullif(trim(p_ingeniero_responsable),''), p_hora_fin_trabajo,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0),
    coalesce(p_trabajadores_casa, 0), p_otro_personal,
    nullif(trim(p_visita_tipo_visitante),''), nullif(trim(p_visita_nombre),''),
    nullif(trim(p_visita_organizacion),''), nullif(trim(p_visita_motivo),''),
    p_incidente_tipo, p_incidente_gravedad, nullif(trim(p_incidente_subcontratista),''),
    coalesce(p_incidente_lesionados, 0),
    p_incidente_descripcion, p_incidente_acciones,
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros,
    p_hubo_equipos
  );

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad)
      select p_id, i->>'estructura', i->>'actividad', nullif(i->>'cantidad','')::numeric
      from jsonb_array_elements(p_actividades) as i;
    end if;
    if jsonb_array_length(coalesce(p_restricciones, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_restricciones (bitacora_id, tipo_restriccion, descripcion_otro)
      select p_id, i->>'tipo_restriccion', i->>'descripcion_otro'
      from jsonb_array_elements(p_restricciones) as i;
    end if;
  end if;

  if jsonb_array_length(coalesce(p_fotos, '[]'::jsonb)) > 0 then
    insert into sgc.bitacora_archivos (bitacora_id, nombre, url, tipo_mime)
    select p_id, coalesce(i->>'nombre', 'foto.jpg'), i->>'path', coalesce(i->>'tipo_mime', 'image/jpeg')
    from jsonb_array_elements(p_fotos) as i;
  end if;

  -- W2 — equipos alquilados (aditivo). Cada equipo alimenta otros_valores (U25).
  if coalesce(p_hubo_equipos, false) and p_equipos_alquilados is not null
     and jsonb_array_length(p_equipos_alquilados) > 0 then
    for v_eq in select * from jsonb_array_elements(p_equipos_alquilados) loop
      if coalesce(trim(v_eq->>'equipo'), '') <> '' then
        insert into sgc.bitacora_equipos_alquilados (bitacora_id, equipo, uso, proveedor)
        values (p_id, trim(v_eq->>'equipo'), nullif(trim(v_eq->>'uso'),''), nullif(trim(v_eq->>'proveedor'),''));
        begin
          perform sgc.registrar_otro_valor('bitacora_equipo_alquilado', trim(v_eq->>'equipo'), p_id);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;

  return p_id;
end;
$function$;

grant execute on function sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz, boolean, text, boolean, jsonb,
  boolean, jsonb, text, text, time, text, text, text, text, text
) to authenticated;
