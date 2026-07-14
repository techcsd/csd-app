-- R7 — Crear rutas desde la app móvil.
-- La web SGC ya crea rutas (tabla sgc.rutas, RLS insert = is_admin/flota). La app
-- necesita un RPC security-definer idempotente (patrón de los demás *_app) para
-- encolar la creación offline por UUID de cliente. Aditivo y retrocompatible.

create or replace function sgc.crear_ruta_app(
  p_id                  uuid,
  p_vehiculo_id         uuid,
  p_conductor_id        uuid,
  p_origen              text,
  p_destino             text,
  p_fecha               date default current_date,
  p_km_estimado         numeric default null,
  p_notas               text default null,
  p_destino_proyecto_id uuid default null,
  p_destino_lat         numeric default null,
  p_destino_lng         numeric default null,
  p_capturado_en        timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_cond uuid := p_conductor_id;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;

  -- Gate: mismo criterio que la web (módulo flota) o ser conductor registrado.
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Tu usuario no tiene el módulo Flota';
  end if;

  -- Idempotencia offline: reenvío del mismo op devuelve el mismo id.
  if exists (select 1 from sgc.rutas where id = p_id) then
    return p_id;
  end if;

  if nullif(trim(p_origen), '') is null then raise exception 'El origen es obligatorio'; end if;
  if nullif(trim(p_destino), '') is null then raise exception 'El destino es obligatorio'; end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id and coalesce(activo, true)) then
    raise exception 'Vehículo no encontrado o inactivo';
  end if;

  -- Si no vino el conductor, intenta resolver el del usuario actual.
  if v_cond is null then
    select id into v_cond from sgc.conductores where usuario_id = v_uid and activo limit 1;
  end if;

  insert into sgc.rutas (
    id, vehiculo_id, conductor_id, origen, destino, fecha, km_estimado, notas,
    destino_proyecto_id, destino_lat, destino_lng, estado, creado_por, created_at, updated_at
  ) values (
    p_id, p_vehiculo_id, v_cond, sgc.homologar_texto(p_origen), sgc.homologar_texto(p_destino),
    coalesce(p_fecha, current_date), p_km_estimado, nullif(trim(p_notas), ''),
    p_destino_proyecto_id, p_destino_lat, p_destino_lng, 'planificada', v_uid,
    coalesce(p_capturado_en, now()), now()
  );

  return p_id;
end;
$$;

grant execute on function sgc.crear_ruta_app(uuid, uuid, uuid, text, text, date, numeric, text, uuid, numeric, numeric, timestamptz) to authenticated;
