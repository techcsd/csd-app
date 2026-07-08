-- CSD App · M2 · Conduces (driver delivery of dispatched material).
-- Links app users to the conductor catalog, adds delivery evidence columns to
-- salidas_inventario, and driver-side RPCs. Reuses SGC's existing despachado →
-- entregado / entregado_incompleto trazabilidad (mirrors confirmar_recepcion_salida).
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08e-conduces.sql

-- ── App user ↔ conductor link ───────────────────────────────────────────
alter table sgc.conductores add column if not exists usuario_id uuid references sgc.usuarios(id);
create index if not exists idx_conductores_usuario on sgc.conductores (usuario_id);

-- ── Delivery evidence on the conduce ────────────────────────────────────
alter table sgc.salidas_inventario add column if not exists entregado_por uuid references sgc.usuarios(id);
alter table sgc.salidas_inventario add column if not exists entregado_en timestamptz;
alter table sgc.salidas_inventario add column if not exists entrega_receptor text;
alter table sgc.salidas_inventario add column if not exists entrega_firma_path text;
alter table sgc.salidas_inventario add column if not exists entrega_foto_path text;

-- ── Driver delivery: close the conduce with photo + receiver + signature ──
create or replace function sgc.entregar_conduce(
  p_salida_id uuid,
  p_items jsonb,
  p_receptor text,
  p_firma_url text,
  p_foto_url text,
  p_notas text default null
) returns text
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_salida sgc.salidas_inventario%rowtype;
  v_incompleto boolean;
  v_item jsonb;
begin
  select * into v_salida from sgc.salidas_inventario where id = p_salida_id for update;
  if not found then raise exception 'Conduce no encontrado.'; end if;

  -- Idempotency: a re-sent op where I already delivered it succeeds quietly.
  if v_salida.estado in ('entregado', 'entregado_incompleto') then
    if v_salida.entregado_por = auth.uid() then return v_salida.estado; end if;
    raise exception 'Este conduce ya fue entregado.';
  end if;
  if v_salida.estado <> 'despachado' then
    raise exception 'Este conduce no está despachado.';
  end if;

  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_salida.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor asignado a este conduce.';
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
    entregado_por = auth.uid(),
    entregado_en = now(),
    entrega_receptor = p_receptor,
    entrega_firma_path = p_firma_url,
    entrega_foto_path = p_foto_url,
    recibido_en = now(),
    notas_recepcion = coalesce(p_notas, notas_recepcion)
  where id = p_salida_id;

  return case when v_incompleto then 'entregado_incompleto' else 'entregado' end;
end;
$$;

-- ── Driver's dispatched conduces (despachado) assigned to them ────────────
create or replace function sgc.mis_conduces_hoy()
returns jsonb
language sql
stable
security definer
set search_path = sgc, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'fecha', s.fecha,
    'estado', s.estado,
    'destino', p.nombre,
    'bodega', b.nombre,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'detalle_id', d.id, 'articulo', a.nombre, 'unidad', a.unidad, 'cantidad', d.cantidad)), '[]'::jsonb)
      from sgc.detalle_salidas d
      join sgc.articulos a on a.id = d.articulo_id
      where d.salida_id = s.id
    )
  ) order by s.fecha desc), '[]'::jsonb)
  from sgc.salidas_inventario s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.bodegas b on b.id = s.bodega_id
  where s.estado = 'despachado'
    and s.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$$;

-- ── Driver's routes for today ─────────────────────────────────────────────
create or replace function sgc.mis_rutas_hoy()
returns jsonb
language sql
stable
security definer
set search_path = sgc, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'origen', r.origen, 'destino', r.destino,
    'estado', r.estado, 'fecha', r.fecha) order by r.fecha desc), '[]'::jsonb)
  from sgc.rutas r
  where r.fecha = current_date
    and r.conductor_id in (select id from sgc.conductores where usuario_id = auth.uid());
$$;

-- ── Driver updates a route's state ────────────────────────────────────────
create or replace function sgc.marcar_ruta_estado(p_ruta_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare v_ruta sgc.rutas%rowtype;
begin
  if p_estado not in ('en_curso', 'completada', 'cancelada') then
    raise exception 'Estado inválido: %', p_estado;
  end if;
  select * into v_ruta from sgc.rutas where id = p_ruta_id for update;
  if not found then raise exception 'Ruta no encontrada.'; end if;
  if not (
    sgc.is_admin() or sgc.tiene_modulo('flota')
    or exists (select 1 from sgc.conductores c
               where c.id = v_ruta.conductor_id and c.usuario_id = auth.uid())
  ) then
    raise exception 'No eres el conductor de esta ruta.';
  end if;
  update sgc.rutas set estado = p_estado, updated_at = now() where id = p_ruta_id;
end;
$$;

grant execute on function sgc.entregar_conduce(uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function sgc.mis_conduces_hoy() to authenticated;
grant execute on function sgc.mis_rutas_hoy() to authenticated;
grant execute on function sgc.marcar_ruta_estado(uuid, text) to authenticated;
