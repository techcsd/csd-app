-- CSD App · M4 · Inventario (salida/entrada) + Solicitudes, offline-idempotent.
-- App wrappers take a client UUID (p_id) and mirror SGC's existing RPCs so the
-- same stock triggers (trg_detalle_*_stock → adjust_stock) and downstream
-- modules fire exactly as from the web. Writes only via these SECURITY DEFINER
-- RPCs; re-sends are safe.
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08g-inventario-solicitudes.sql

-- Optional evidence photo on field movements.
alter table sgc.salidas_inventario add column if not exists foto_path text;
alter table sgc.entradas_inventario add column if not exists foto_path text;

-- Private bucket for inventory movement photos.
insert into storage.buckets (id, name, public)
values ('inventario', 'inventario', false)
on conflict (id) do nothing;

drop policy if exists "csd_inventario_insert" on storage.objects;
create policy "csd_inventario_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'inventario');
drop policy if exists "csd_inventario_select" on storage.objects;
create policy "csd_inventario_select" on storage.objects
  for select to authenticated using (bucket_id = 'inventario');
drop policy if exists "csd_inventario_update" on storage.objects;
create policy "csd_inventario_update" on storage.objects
  for update to authenticated using (bucket_id = 'inventario') with check (bucket_id = 'inventario');

-- ── Salida de material (consumo) ──────────────────────────────────────────
create or replace function sgc.registrar_salida_app(
  p_id uuid,
  p_bodega_id uuid,
  p_proyecto_id uuid,
  p_motivo text,
  p_items jsonb,
  p_foto_path text default null,
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_item jsonb;
  v_stock numeric;
  v_nombre text;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.salidas_inventario where id = p_id) then
    return p_id;
  end if;

  -- Server-side stock validation (mirrors registrar_salida_inventario).
  for v_item in select * from jsonb_array_elements(p_items) loop
    select s.cantidad, a.nombre into v_stock, v_nombre
    from sgc.stock_por_bodega s join sgc.articulos a on a.id = s.articulo_id
    where s.articulo_id = (v_item->>'articulo_id')::uuid and s.bodega_id = p_bodega_id;
    v_stock := coalesce(v_stock, 0);
    if v_stock < (v_item->>'cantidad')::numeric then
      raise exception 'Stock insuficiente para "%". Disponible: %, Solicitado: %',
        coalesce(v_nombre, 'material'), v_stock, (v_item->>'cantidad')::numeric;
    end if;
  end loop;

  insert into sgc.salidas_inventario (id, fecha, bodega_id, proyecto_id, motivo, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_proyecto_id, coalesce(p_motivo, 'Consumo en obra'), auth.uid(), p_foto_path);

  -- Trigger trg_detalle_salidas_stock decrements stock per detalle row.
  insert into sgc.detalle_salidas (salida_id, articulo_id, cantidad)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$$;

-- ── Entrada de material (directa) ─────────────────────────────────────────
create or replace function sgc.registrar_entrada_app(
  p_id uuid,
  p_bodega_id uuid,
  p_referencia text,
  p_items jsonb,
  p_foto_path text default null,
  p_capturado_en timestamptz default now()
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.entradas_inventario where id = p_id) then
    return p_id;
  end if;

  insert into sgc.entradas_inventario (id, fecha, bodega_id, referencia, creado_por, foto_path)
  values (p_id, p_capturado_en::date, p_bodega_id, p_referencia, auth.uid(), p_foto_path);

  -- Trigger on detalle_entradas increments stock per row.
  insert into sgc.detalle_entradas (entrada_id, articulo_id, cantidad)
  select p_id, (i->>'articulo_id')::uuid, (i->>'cantidad')::numeric
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$$;

-- ── Solicitud de material ─────────────────────────────────────────────────
create or replace function sgc.crear_solicitud_app(
  p_id uuid,
  p_proyecto_id uuid,
  p_urgencia text,
  p_notas text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('compras') then
    raise exception 'Tu usuario no tiene el módulo Solicitudes';
  end if;
  if exists (select 1 from sgc.solicitudes_material where id = p_id) then
    return p_id;
  end if;

  insert into sgc.solicitudes_material (id, proyecto_id, solicitante_id, estado, urgencia, notas)
  values (p_id, p_proyecto_id, auth.uid(), 'pendiente', coalesce(p_urgencia, 'normal'), p_notas);

  insert into sgc.solicitud_material_items (solicitud_id, articulo_id, descripcion, cantidad, unidad)
  select p_id, nullif(i->>'articulo_id', '')::uuid, i->>'descripcion',
         (i->>'cantidad')::numeric, i->>'unidad'
  from jsonb_array_elements(p_items) as i;

  return p_id;
end;
$$;

grant execute on function sgc.registrar_salida_app(uuid, uuid, uuid, text, jsonb, text, timestamptz) to authenticated;
grant execute on function sgc.registrar_entrada_app(uuid, uuid, text, jsonb, text, timestamptz) to authenticated;
grant execute on function sgc.crear_solicitud_app(uuid, uuid, text, text, jsonb) to authenticated;
