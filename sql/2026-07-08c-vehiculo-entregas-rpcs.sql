-- CSD App · M2 · RPCs for the vehicle responsibility checklist.
-- SECURITY DEFINER (writes bypass the read-only RLS) + explicit module check +
-- idempotency by client UUID (safe re-send from the offline outbox).
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08c-vehiculo-entregas-rpcs.sql

-- Create/close a custody handoff. p_fotos: [{slot,path,id?}], p_danos:
-- [{zona,descripcion,foto_path,id?}], p_gps: {lat,lng} | null.
create or replace function sgc.crear_entrega_vehiculo(
  p_id uuid,
  p_vehiculo_id uuid,
  p_tipo text,
  p_km numeric,
  p_combustible text,
  p_tiene_danos boolean,
  p_danos jsonb,
  p_firma_url text,
  p_fotos jsonb,
  p_gps jsonb,
  p_capturado_en timestamptz,
  p_observacion text default null
) returns uuid
language plpgsql
security definer
set search_path = sgc, public
as $$
declare
  v_uid uuid := auth.uid();
  v_recepcion sgc.vehiculo_entregas;
  v_estado text := 'abierta';
  v_recepcion_id uuid := null;
  v_requiere boolean := false;
  v_slots text[];
  v_required text[] := array['frente','atras','lado_izq','lado_der','tablero','combustible'];
  s text;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('flota') then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotency: a re-sent op returns the existing id, no duplicate.
  if exists (select 1 from sgc.vehiculo_entregas where id = p_id) then
    return p_id;
  end if;

  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- Required guided photos (server double-checks the client).
  select array_agg(distinct f->>'slot')
    into v_slots
    from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;
  foreach s in array v_required loop
    if v_slots is null or not (s = any(v_slots)) then
      raise exception 'Falta la foto obligatoria: %', s;
    end if;
  end loop;

  if p_tipo = 'recepcion' then
    if exists (select 1 from sgc.vehiculo_entregas
               where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta') then
      raise exception 'Este vehículo ya tiene una entrega abierta';
    end if;
    v_estado := 'abierta';
  elsif p_tipo = 'devolucion' then
    select * into v_recepcion from sgc.vehiculo_entregas
      where vehiculo_id = p_vehiculo_id and tipo = 'recepcion' and estado = 'abierta'
      order by created_at desc limit 1;
    if v_recepcion.id is null then
      raise exception 'No hay una entrega abierta de este vehículo para devolver';
    end if;
    if v_recepcion.conductor_usuario_id <> v_uid and not sgc.is_admin() then
      raise exception 'La entrega abierta es de otro conductor';
    end if;
    v_recepcion_id := v_recepcion.id;
    v_estado := 'cerrada';
    v_requiere := coalesce(p_tiene_danos, false) or p_km < v_recepcion.km;
  else
    raise exception 'Tipo inválido: %', p_tipo;
  end if;

  insert into sgc.vehiculo_entregas(
    id, vehiculo_id, conductor_usuario_id, tipo, entrega_recepcion_id, estado,
    km, combustible, tiene_danos, observacion, firma_url, gps_lat, gps_lng,
    requiere_revision, capturado_en, creado_por
  ) values (
    p_id, p_vehiculo_id, v_uid, p_tipo, v_recepcion_id, v_estado,
    p_km, p_combustible, coalesce(p_tiene_danos, false), p_observacion, p_firma_url,
    nullif(p_gps->>'lat', '')::numeric, nullif(p_gps->>'lng', '')::numeric,
    v_requiere, p_capturado_en, v_uid
  );

  insert into sgc.vehiculo_entrega_fotos(id, entrega_id, slot, storage_path)
  select coalesce(nullif(f->>'id', '')::uuid, gen_random_uuid()), p_id, f->>'slot', f->>'path'
  from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) f;

  insert into sgc.vehiculo_entrega_danos(id, entrega_id, zona, descripcion, foto_path, es_nuevo)
  select coalesce(nullif(d->>'id', '')::uuid, gen_random_uuid()), p_id,
         d->>'zona', d->>'descripcion', d->>'foto_path', (p_tipo = 'devolucion')
  from jsonb_array_elements(coalesce(p_danos, '[]'::jsonb)) d;

  if p_tipo = 'devolucion' then
    update sgc.vehiculo_entregas set estado = 'cerrada' where id = v_recepcion_id;
    update sgc.vehiculos
      set responsable_id = null, kilometraje = greatest(coalesce(kilometraje, 0), p_km::int)
      where id = p_vehiculo_id;
  else
    update sgc.vehiculos
      set responsable_id = v_uid, kilometraje = greatest(coalesce(kilometraje, 0), p_km::int)
      where id = p_vehiculo_id;
  end if;

  return p_id;
end;
$$;

-- Current custody state of a vehicle (for Flota web + the app).
create or replace function sgc.vehiculo_estado_actual(p_vehiculo_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = sgc, public
as $$
  select jsonb_build_object(
    'vehiculo_id', v.id,
    'placa', v.placa,
    'km', v.kilometraje,
    'responsable_id', v.responsable_id,
    'responsable', (select nombre from sgc.usuarios where id = v.responsable_id),
    'entrega_abierta', (
      select to_jsonb(e) from sgc.vehiculo_entregas e
      where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta'
      order by e.created_at desc limit 1
    )
  )
  from sgc.vehiculos v where v.id = p_vehiculo_id;
$$;

-- Everything a driver needs on open: vehicles to receive / already in charge.
create or replace function sgc.mis_pendientes_transporte()
returns jsonb
language sql
stable
security definer
set search_path = sgc, public
as $$
  select jsonb_build_object(
    'a_cargo', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entrega_id', e.id, 'vehiculo_id', v.id, 'placa', v.placa,
        'marca', v.marca, 'modelo', v.modelo, 'km', e.km, 'desde', e.capturado_en)), '[]'::jsonb)
      from sgc.vehiculo_entregas e
      join sgc.vehiculos v on v.id = e.vehiculo_id
      where e.conductor_usuario_id = auth.uid() and e.tipo = 'recepcion' and e.estado = 'abierta'
    ),
    'por_recibir', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'vehiculo_id', v.id, 'placa', v.placa, 'marca', v.marca,
        'modelo', v.modelo, 'km', v.kilometraje)), '[]'::jsonb)
      from sgc.vehiculos v
      where v.responsable_id = auth.uid() and coalesce(v.activo, true)
        and not exists (
          select 1 from sgc.vehiculo_entregas e
          where e.vehiculo_id = v.id and e.tipo = 'recepcion' and e.estado = 'abierta')
    )
  );
$$;

grant execute on function sgc.crear_entrega_vehiculo(uuid, uuid, text, numeric, text, boolean, jsonb, text, jsonb, jsonb, timestamptz, text) to authenticated;
grant execute on function sgc.vehiculo_estado_actual(uuid) to authenticated;
grant execute on function sgc.mis_pendientes_transporte() to authenticated;
