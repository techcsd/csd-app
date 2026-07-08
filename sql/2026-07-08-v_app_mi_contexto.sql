-- CSD App · M1 · Context view for the field app.
-- Bundles the signed-in user's identity, roles, module gates and active obra
-- into one call so the app can boot with a single round-trip.
--
-- NOTE: requires DDL access (Supabase SQL editor, or CLI with
-- SUPABASE_ACCESS_TOKEN, or a Postgres connection string). The Data API
-- service_role/secret keys CANNOT run this. Until applied, the app falls back
-- to querying usuarios + usuarios_roles directly (works, just chattier).
--
-- Safe to run repeatedly.

create or replace view sgc.v_app_mi_contexto as
select
  u.id                                   as usuario_id,
  u.nombre,
  u.email,
  u.activo,
  u.avatar_path,
  coalesce(
    array_agg(distinct r.codigo) filter (where r.codigo is not null),
    '{}'
  )                                      as roles,
  coalesce(
    (
      select array_agg(distinct m)
      from sgc.usuarios_roles ur2
      join sgc.roles r2 on r2.id = ur2.rol_id
      cross join lateral unnest(r2.modulos) as m
      where ur2.usuario_id = u.id
    ),
    '{}'
  )                                      as modulos
from sgc.usuarios u
left join sgc.usuarios_roles ur on ur.usuario_id = u.id
left join sgc.roles r on r.id = ur.rol_id
where u.id = auth.uid()
group by u.id, u.nombre, u.email, u.activo, u.avatar_path;

-- The view runs with the querying user's privileges and is already scoped to
-- auth.uid(), so it only ever returns the caller's own row.
grant select on sgc.v_app_mi_contexto to authenticated;

comment on view sgc.v_app_mi_contexto is
  'CSD App: current user context (identity + roles + module gates). Active obra / vehículo a cargo added in later milestones.';
