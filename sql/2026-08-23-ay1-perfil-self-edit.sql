-- AY1 — self-service profile edit (app "Mi perfil" + web mirror por AY12).
-- Aditivo y retrocompatible. Un usuario de campo puede editar SU nombre visible y
-- teléfono (NO cédula/login, rol, permisos, es_prueba — eso es de admin). La foto ya
-- tiene su propio RPC self-scoped (actualizar_mi_avatar). Todo auditado.
begin;

-- 1) Columna teléfono (no existía). Nullable, sin default.
alter table sgc.usuarios add column if not exists telefono text;

-- 2) Lectura de MI perfil (self-scoped por auth.uid()). Security definer para
--    saltar la RLS admin-only de usuarios devolviendo SOLO la fila del que llama.
create or replace function sgc.mi_perfil()
returns table (
  id uuid,
  nombre text,
  email text,
  telefono text,
  avatar_path text
)
language sql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select u.id, u.nombre, u.email, u.telefono, u.avatar_path
  from sgc.usuarios u
  where u.id = auth.uid();
$$;

-- 3) Edición self-service de nombre + teléfono. NUNCA toca rol/permisos/es_prueba/
--    login. Nombre en blanco conserva el actual; teléfono en blanco lo limpia.
create or replace function sgc.mi_perfil_actualizar(p_nombre text, p_telefono text)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'No autenticado.';
  end if;

  update sgc.usuarios
  set nombre = coalesce(nullif(btrim(p_nombre), ''), nombre),
      telefono = nullif(btrim(p_telefono), ''),
      updated_at = now()
  where id = v_uid;

  insert into sgc.audit_log (actor_id, action, target_user_id, metadata)
  values (
    v_uid,
    'mi_perfil_actualizado',
    v_uid,
    jsonb_build_object('nombre', nullif(btrim(p_nombre), ''), 'telefono', nullif(btrim(p_telefono), ''))
  );
end;
$$;

-- 4) Grants (schema ya expuesto; solo authenticated ejecuta).
grant execute on function sgc.mi_perfil() to authenticated;
grant execute on function sgc.mi_perfil_actualizar(text, text) to authenticated;

commit;
