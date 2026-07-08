-- CSD App · M4 · Conteo rápido (physical count → stock adjustment) with audit.
-- Sets each counted article to its physical quantity via adjust_stock, and
-- records the before/after per item for traceability (SGC rule #3).
-- Apply: node scripts/apply-migration.mjs sql/2026-07-08j-conteo.sql

create table if not exists sgc.conteos_inventario (
  id          uuid primary key,
  bodega_id   uuid not null references sgc.bodegas(id),
  motivo      text,
  creado_por  uuid not null default auth.uid() references sgc.usuarios(id),
  created_at  timestamptz not null default now()
);

create table if not exists sgc.conteo_items (
  id                uuid primary key default gen_random_uuid(),
  conteo_id         uuid not null references sgc.conteos_inventario(id),
  articulo_id       uuid not null references sgc.articulos(id),
  cantidad_antes    numeric not null,
  cantidad_contada  numeric not null
);

create index if not exists idx_conteo_items_conteo on sgc.conteo_items (conteo_id);
create index if not exists idx_conteos_bodega on sgc.conteos_inventario (bodega_id, created_at desc);

alter table sgc.conteos_inventario enable row level security;
alter table sgc.conteo_items enable row level security;

drop policy if exists "conteos_select" on sgc.conteos_inventario;
create policy "conteos_select" on sgc.conteos_inventario for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));
drop policy if exists "conteo_items_select" on sgc.conteo_items;
create policy "conteo_items_select" on sgc.conteo_items for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('inventario'));

grant usage on schema sgc to authenticated;
grant select on sgc.conteos_inventario to authenticated;
grant select on sgc.conteo_items to authenticated;

-- Apply a physical count. p_items: [{articulo_id, cantidad_contada}].
create or replace function sgc.registrar_conteo_app(
  p_id uuid,
  p_bodega_id uuid,
  p_motivo text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_item jsonb;
  v_antes numeric;
  v_contada numeric;
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not sgc.tiene_modulo('inventario') then
    raise exception 'Tu usuario no tiene el módulo Inventario';
  end if;
  if exists (select 1 from sgc.conteos_inventario where id = p_id) then
    return p_id;
  end if;

  insert into sgc.conteos_inventario (id, bodega_id, motivo, creado_por)
  values (p_id, p_bodega_id, coalesce(p_motivo, 'Conteo físico'), auth.uid());

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_contada := (v_item->>'cantidad_contada')::numeric;
    select coalesce(cantidad, 0) into v_antes
    from sgc.stock_por_bodega
    where articulo_id = (v_item->>'articulo_id')::uuid and bodega_id = p_bodega_id;
    v_antes := coalesce(v_antes, 0);

    insert into sgc.conteo_items (conteo_id, articulo_id, cantidad_antes, cantidad_contada)
    values (p_id, (v_item->>'articulo_id')::uuid, v_antes, v_contada);

    -- Move stock to the counted quantity.
    if v_contada <> v_antes then
      perform sgc.adjust_stock((v_item->>'articulo_id')::uuid, p_bodega_id, v_contada - v_antes);
    end if;
  end loop;

  return p_id;
end;
$$;

grant execute on function sgc.registrar_conteo_app(uuid, uuid, text, jsonb) to authenticated;
