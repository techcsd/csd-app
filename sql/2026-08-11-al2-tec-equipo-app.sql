-- =============================================================================
-- PROMPT-4 FASE 4 (AL2) — Inventario tecnológico EN LA APP (offline-first).
-- Aditivo, idempotente, retrocompatible. No toca la web (que hace CRUD directo).
--
-- La web inserta/actualiza `tec_equipos` por tabla directa y genera el código
-- TEC-#### en el cliente. La app móvil escribe por OUTBOX (idempotente por UUID),
-- así que necesita un RPC security-definer que: (a) haga UPSERT por id (re-enviar
-- la misma op no duplica), (b) genere el código en el servidor al crear, y (c)
-- respete el gate (admin | módulo tecnologia). Espeja el patrón crear_*_app.
-- =============================================================================

begin;

create or replace function sgc.guardar_tec_equipo_app(
  p_id           uuid,
  p_nombre       text,
  p_tipo_id      uuid,
  p_bodega_id    uuid,
  p_costo        numeric,
  p_moneda       text,
  p_marca        text,
  p_modelo       text,
  p_serie        text,
  p_estado       text,
  p_notas        text,
  p_fotos        text[],
  p_foto_portada text
) returns uuid
language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid    uuid := auth.uid();
  v_codigo text;
  v_n      int;
  v_moneda text := upper(coalesce(nullif(p_moneda, ''), 'DOP'));
  v_estado text := coalesce(nullif(p_estado, ''), 'en_stock');
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('tecnologia')) then
    raise exception 'No autorizado para el inventario tecnológico.';
  end if;
  if v_moneda not in ('DOP', 'USD') then v_moneda := 'DOP'; end if;
  if v_estado not in ('activo', 'en_reparacion', 'en_stock', 'dado_de_baja') then
    v_estado := 'en_stock';
  end if;

  -- UPSERT idempotente por id (reenvío del outbox no duplica).
  if exists (select 1 from sgc.tec_equipos where id = p_id) then
    update sgc.tec_equipos set
      nombre       = coalesce(nullif(p_nombre, ''), nombre),
      tipo_id      = p_tipo_id,
      bodega_id    = p_bodega_id,
      costo        = p_costo,
      moneda       = v_moneda,
      marca        = nullif(p_marca, ''),
      modelo       = nullif(p_modelo, ''),
      serie        = nullif(p_serie, ''),
      estado       = v_estado,
      notas        = nullif(p_notas, ''),
      fotos        = coalesce(p_fotos, '{}'),
      foto_portada = p_foto_portada,
      foto_path    = coalesce(p_foto_portada, foto_path),
      updated_at   = now()
    where id = p_id;
    return p_id;
  end if;

  -- Código secuencial TEC-#### (server-side).
  select coalesce(max((regexp_replace(codigo, '\D', '', 'g'))::int), 0) + 1
    into v_n
    from sgc.tec_equipos
   where codigo ~ '^TEC-\d+$';
  v_codigo := 'TEC-' || lpad(v_n::text, 4, '0');

  insert into sgc.tec_equipos (
    id, codigo, nombre, tipo_id, bodega_id, costo, moneda,
    marca, modelo, serie, estado, notas, fotos, foto_portada, foto_path, activo
  ) values (
    p_id, v_codigo, p_nombre, p_tipo_id, p_bodega_id, p_costo, v_moneda,
    nullif(p_marca, ''), nullif(p_modelo, ''), nullif(p_serie, ''), v_estado,
    nullif(p_notas, ''), coalesce(p_fotos, '{}'), p_foto_portada, p_foto_portada, true
  );

  -- Historial (best-effort; espeja addHistorial de la web).
  begin
    insert into sgc.tec_equipo_historial (equipo_id, tipo_cambio, descripcion, usuario_id)
    values (p_id, 'asignacion', 'Equipo registrado desde la app (estado: ' || v_estado || ')', v_uid);
  exception when others then null;
  end;

  return p_id;
end;
$$;

grant execute on function sgc.guardar_tec_equipo_app(
  uuid, text, uuid, uuid, numeric, text, text, text, text, text, text, text[], text
) to authenticated, service_role;

comment on function sgc.guardar_tec_equipo_app(uuid, text, uuid, uuid, numeric, text, text, text, text, text, text, text[], text) is
  'AL2 — UPSERT idempotente de un equipo tecnológico desde la app (outbox). Genera código TEC-#### al crear; gate admin|tecnologia. La web sigue con CRUD directo.';

commit;
