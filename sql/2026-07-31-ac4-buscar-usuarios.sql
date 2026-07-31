-- AC4 (Notas) — búsqueda de usuarios para el flujo "compartir nota".
-- `sgc.usuarios` tiene RLS solo-admin (un usuario normal solo se lee a sí mismo),
-- así que la app no puede buscar destinatarios directamente. Se expone una función
-- SECURITY DEFINER que devuelve datos mínimos (id/nombre/email) de usuarios ACTIVOS
-- que coincidan con el término (>= 2 caracteres), excluyéndose a sí mismo.
-- Aditivo y retrocompatible: no toca tablas ni RLS existentes.

create or replace function sgc.buscar_usuarios(p_term text)
returns table (id uuid, nombre text, email text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.id, u.nombre, u.email
  from sgc.usuarios u
  where coalesce(u.activo, true) = true
    and u.id <> auth.uid()
    and length(trim(coalesce(p_term, ''))) >= 2
    and (
      u.nombre ilike '%' || trim(p_term) || '%'
      or coalesce(u.email, '') ilike '%' || trim(p_term) || '%'
    )
  order by u.nombre
  limit 20;
$$;

revoke all on function sgc.buscar_usuarios(text) from public;
grant execute on function sgc.buscar_usuarios(text) to authenticated;

-- Resolver ids -> nombre/email para mostrar CON QUIÉN está compartida una nota
-- (nota_compartidos guarda solo usuario_id y usuarios es RLS solo-admin). Solo
-- expone nombre/email de usuarios activos; datos mínimos, sin filtrar por rol.
create or replace function sgc.usuarios_por_ids(p_ids uuid[])
returns table (id uuid, nombre text, email text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.id, u.nombre, u.email
  from sgc.usuarios u
  where u.id = any(coalesce(p_ids, '{}'::uuid[]));
$$;

revoke all on function sgc.usuarios_por_ids(uuid[]) from public;
grant execute on function sgc.usuarios_por_ids(uuid[]) to authenticated;
