-- CSD App · M3 · Idempotent bitácora RPC for the offline outbox.
-- Mirrors sgc.crear_entrada_bitacora but takes a client UUID (p_id) so a
-- re-sent capture never duplicates, sets usuario_id = auth.uid(), checks the
-- bitacora module, and records photo rows (uploaded to the existing
-- sgc-bitacora bucket) into bitacora_archivos.
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08f-bitacora-app.sql

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
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('bitacora') then
    raise exception 'Tu usuario no tiene el módulo Bitácora';
  end if;

  -- Idempotency: a re-sent op returns the existing row.
  if exists (select 1 from sgc.bitacoras where id = p_id) then
    return p_id;
  end if;

  insert into sgc.bitacoras (
    id, usuario_id, proyecto_id, fecha, tipo, comentarios,
    personal_carpinteria, personal_acero, trabajadores_casa, otro_personal,
    incidente_tipo, incidente_gravedad, incidente_lesionados,
    incidente_descripcion, incidente_acciones
  ) values (
    p_id, v_uid, p_proyecto_id, p_fecha, p_tipo, p_comentarios,
    coalesce(p_personal_carpinteria, 0), coalesce(p_personal_acero, 0),
    coalesce(p_trabajadores_casa, 0), p_otro_personal,
    p_incidente_tipo, p_incidente_gravedad, coalesce(p_incidente_lesionados, 0),
    p_incidente_descripcion, p_incidente_acciones
  );

  if p_tipo = 'parte_diario' then
    if jsonb_array_length(coalesce(p_actividades, '[]'::jsonb)) > 0 then
      insert into sgc.bitacora_actividades (bitacora_id, estructura, actividad)
      select p_id, i->>'estructura', i->>'actividad'
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
$$;

grant execute on function sgc.crear_bitacora_app(
  uuid, uuid, date, text, text, smallint, smallint, smallint, text, jsonb, jsonb,
  text, text, smallint, text, text, jsonb, timestamptz
) to authenticated;
