-- CSD App · M4 · Bodeguero receives a dispatched conduce (offline-idempotent).
-- Mirrors sgc.confirmar_recepcion_salida (same despachado→entregado/incompleto
-- transition + authorization) and adds an optional reception photo. Idempotent:
-- a re-send on an already-received conduce returns its state instead of failing.
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08i-recibir-conduce.sql

create or replace function sgc.recibir_conduce_app(
  p_salida_id uuid,
  p_items jsonb,
  p_notas text default null,
  p_foto_path text default null
) returns text
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
  v_autorizado boolean;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotency: already received (by the app, a chofer, or the web) → succeed.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    return v_salida.estado;
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  select
    sgc.is_admin() or sgc.tiene_modulo('inventario')
    or (v_salida.proyecto_id is not null and exists (
      select 1 from sgc.proyecto_empleados pe
      join sgc.empleados e on e.id = pe.empleado_id
      where pe.proyecto_id = v_salida.proyecto_id and e.usuario_id = auth.uid()))
    into v_autorizado;
  if not v_autorizado then
    raise exception 'No autorizado para recibir este conduce.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update sgc.detalle_salidas
    set cantidad_recibida = (v_item->>'cantidad_recibida')::numeric
    where id = (v_item->>'detalle_id')::uuid and salida_id = p_salida_id;
  end loop;

  select exists (
    select 1 from sgc.detalle_salidas
    where salida_id = p_salida_id and (cantidad_recibida is null or cantidad_recibida < cantidad)
  ) into v_incompleto;

  update sgc.salidas_inventario set
    estado = case when v_incompleto then 'entregado_incompleto' else 'entregado' end,
    recibido_por = auth.uid(),
    recibido_en = now(),
    notas_recepcion = p_notas,
    foto_path = coalesce(p_foto_path, foto_path)
  where id = p_salida_id;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$$;

grant execute on function sgc.recibir_conduce_app(uuid, jsonb, text, text) to authenticated;
