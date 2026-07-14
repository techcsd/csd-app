-- R21/R22/R24 — Bitácora: clima (lluvia), migración y cantidad por actividad.
-- Las columnas ya existen (llovio, lluvia_detalle, hubo_migracion,
-- migracion_obreros en bitacoras; cantidad en bitacora_actividades). Aquí se
-- extiende crear_bitacora_app para recibirlas. Aditivo: los 4 params nuevos
-- tienen default, así la versión vieja de la app (18 args) sigue funcionando.

drop function if exists sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz
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
  p_migracion_obreros jsonb default null
) returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
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
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    incidente_tipo, incidente_gravedad, incidente_lesionados,
    incidente_descripcion, incidente_acciones,
    llovio, lluvia_detalle, hubo_migracion, migracion_obreros
  ) values (
    p_id, v_uid, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0),
    coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_incidente_tipo, p_incidente_gravedad, coalesce(p_incidente_lesionados, 0),
    p_incidente_descripcion, p_incidente_acciones,
    p_llovio, p_lluvia_detalle, p_hubo_migracion, p_migracion_obreros
  );

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad, cantidad)
      select p_id, i->>'estructura', i->>'actividad',
             nullif(i->>'cantidad','')::numeric
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

  return p_id;
end;
$function$;

grant execute on function sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz, boolean, text, boolean, jsonb
) to authenticated;
