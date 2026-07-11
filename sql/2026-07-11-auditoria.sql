-- CSD/SGC · Comprehensive audit trail (traceability).
-- DB-level change-data-capture: a generic AFTER trigger records every
-- INSERT/UPDATE/DELETE on business tables into sgc.auditoria, tagging the real
-- actor via auth.uid(). Because it lives in the DB, it captures changes made
-- from BOTH the SGC web and the CSD field app (whose SECURITY DEFINER RPCs still
-- carry the caller's JWT), with no app code needed.
-- Coexists with the existing narrow sgc.audit_log (admin user/role actions).
-- Apply: node scripts/apply-migration.mjs sql/2026-07-11-auditoria.sql

-- ── Audit table ───────────────────────────────────────────────────────────
create table if not exists sgc.auditoria (
  id            bigint generated always as identity primary key,
  tabla         text not null,
  registro_id   text not null,                    -- pk (id) as text
  accion        text not null check (accion in ('INSERT','UPDATE','DELETE')),
  actor_id      uuid references sgc.usuarios(id), -- who did it (null = sistema/migración)
  cambios       jsonb,                            -- UPDATE: {col:{antes,despues}} of changed cols
  datos_despues jsonb,                            -- INSERT: the created row
  datos_antes   jsonb,                            -- DELETE: the removed row
  creado_en     timestamptz not null default now()
);

create index if not exists idx_auditoria_creado on sgc.auditoria (creado_en desc);
create index if not exists idx_auditoria_tabla_reg on sgc.auditoria (tabla, registro_id);
create index if not exists idx_auditoria_actor on sgc.auditoria (actor_id);
create index if not exists idx_auditoria_accion on sgc.auditoria (accion);

-- ── Generic trigger function ──────────────────────────────────────────────
-- Skips noise columns (auto timestamps / search vectors) from the UPDATE diff;
-- if nothing meaningful changed, no row is written.
create or replace function sgc.fn_auditoria() returns trigger
language plpgsql
security definer
set search_path = sgc, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_old   jsonb;
  v_new   jsonb;
  v_cambios jsonb := '{}'::jsonb;
  k text;
  v_skip constant text[] := array['updated_at','actualizado_en','search','tsv','fts','embedding','search_vector'];
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, datos_despues)
      values (tg_table_name, coalesce(v_new->>'id',''), 'INSERT', v_actor, v_new);
    return new;

  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    for k in select jsonb_object_keys(v_new) loop
      if k = any(v_skip) then continue; end if;
      if (v_new->k) is distinct from (v_old->k) then
        v_cambios := v_cambios || jsonb_build_object(k, jsonb_build_object('antes', v_old->k, 'despues', v_new->k));
      end if;
    end loop;
    if v_cambios <> '{}'::jsonb then
      insert into sgc.auditoria(tabla, registro_id, accion, actor_id, cambios)
        values (tg_table_name, coalesce(v_new->>'id',''), 'UPDATE', v_actor, v_cambios);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    insert into sgc.auditoria(tabla, registro_id, accion, actor_id, datos_antes)
      values (tg_table_name, coalesce(v_old->>'id',''), 'DELETE', v_actor, v_old);
    return old;
  end if;
  return null;
end;
$$;

-- ── Attach to every business table that has an `id` PK ─────────────────────
-- Excludes the audit tables themselves, chat, notifications, and derived caches
-- (high volume / no traceability value). Re-runnable: covers new tables too.
do $$
declare r record;
begin
  for r in
    select t.table_name
    from information_schema.tables t
    where t.table_schema = 'sgc'
      and t.table_type = 'BASE TABLE'
      and exists (
        select 1 from information_schema.columns c
        where c.table_schema='sgc' and c.table_name=t.table_name and c.column_name='id'
      )
      and t.table_name not in (
        'audit_log', 'auditoria', 'existencias',
        'conversaciones', 'conversacion_participantes'
      )
      and t.table_name not like 'mensaje%'
      and t.table_name not like 'notificacion%'
  loop
    execute format('drop trigger if exists trg_auditoria on sgc.%I', r.table_name);
    execute format(
      'create trigger trg_auditoria after insert or update or delete on sgc.%I ' ||
      'for each row execute function sgc.fn_auditoria()', r.table_name);
  end loop;
end $$;

-- ── RLS: readable only by admins or roles granted the `auditoria` module ───
alter table sgc.auditoria enable row level security;
drop policy if exists auditoria_select on sgc.auditoria;
create policy auditoria_select on sgc.auditoria
  for select to authenticated
  using (sgc.is_admin() or sgc.tiene_modulo('auditoria'));
-- No write policies: only the SECURITY DEFINER trigger (table owner) inserts.

grant select on sgc.auditoria to authenticated;

-- ── Distinct actors present in the log (for the viewer's user filter) ──────
create or replace function sgc.auditoria_actores()
returns table(actor_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = sgc, pg_temp
as $$
begin
  if not (sgc.is_admin() or sgc.tiene_modulo('auditoria')) then
    raise exception 'No autorizado.';
  end if;
  return query
    select distinct a.actor_id, u.nombre
    from sgc.auditoria a
    join sgc.usuarios u on u.id = a.actor_id
    where a.actor_id is not null
    order by u.nombre;
end;
$$;

grant execute on function sgc.auditoria_actores() to authenticated;
