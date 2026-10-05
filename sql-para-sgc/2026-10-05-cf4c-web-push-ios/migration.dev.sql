-- ============================================================================
-- CF4c (para el PADRE/SGC) — Web Push REAL para iOS/PWA (VAPID). Migración.
--
-- CONTEXTO: hoy el push es solo FCM/Android (device_tokens + edge send-push). Los
-- iPhone (PWA) no reciben push (0 tokens). Esta migración añade Web Push estándar
-- (VAPID) reutilizando device_tokens: una suscripción web = (endpoint, p256dh, auth).
-- El cliente (app hijo, 2.42.0) ya suscribe con SwPush y llama `registrar_web_push`.
--
-- PIEZAS (esta migración):
--   1) columnas p256dh/auth en device_tokens (nullables; NULL = token FCM/Android).
--   2) RPC registrar_web_push / eliminar_web_push (los llama la PWA).
--   3) send_push: fan-out a DOS edges — send-push (FCM, tokens p256dh NULL) y
--      send-web-push (VAPID, subs p256dh NOT NULL). Aditivo: Android intacto.
--   4) trg_app_version_push UNIFICADO (supersede cf4b): push a quien tenga FCM o sub
--      web; inbox a ésos ∪ usuarios con plataforma ios* (PWA sin sub todavía).
--
-- FUERA de esta migración (ver README del paquete):
--   • editar el edge send-push para que IGNORE las subs web (filtrar p256dh is null),
--     si no, intentaría FCM contra un endpoint web y lo marcaría muerto.
--   • desplegar el edge NUEVO send-web-push.
--   • secretos VAPID (VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT) en Supabase (dev y prod).
--
-- Aditivo e idempotente. Aplicar con --env dev primero (regla 18), luego prod.
-- Reemplaza fzfrnrvndzrjwyvdpkgg por el ref del entorno (dev fzfrnrvndzrjwyvdpkgg / prod
-- jeeqhgccqefbqilntcpu) — o aplica la variante por entorno. La URL de send-push ya
-- existente conserva su ref actual; aquí se reescribe send_push completo por claridad.
-- ============================================================================
begin;

-- 1) Suscripción web: claves de cifrado (NULL en tokens FCM/Android) ──────────
alter table sgc.device_tokens
  add column if not exists p256dh text,
  add column if not exists auth   text;

comment on column sgc.device_tokens.p256dh is
  'CF4c — clave pública P-256 de la suscripción Web Push (NULL = token FCM/Android).';
comment on column sgc.device_tokens.auth is
  'CF4c — secreto auth de la suscripción Web Push (NULL = token FCM/Android).';

-- 2) Alta/baja de una suscripción Web Push (las llama la PWA) ─────────────────
create or replace function sgc.registrar_web_push(
  p_endpoint text, p_p256dh text, p_auth text, p_plataforma text default 'web'
) returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if coalesce(p_plataforma,'') not in ('ios','web') then p_plataforma := 'web'; end if;
  if coalesce(p_endpoint,'') = '' or coalesce(p_p256dh,'') = '' or coalesce(p_auth,'') = '' then
    raise exception 'Suscripción Web Push incompleta';
  end if;
  -- token = endpoint (único). Reutiliza la fila si la suscripción ya existía (re-vincula
  -- al usuario actual: en un equipo compartido, la sub pasa al que inició sesión).
  insert into sgc.device_tokens (usuario_id, token, plataforma, p256dh, auth, activo, updated_at)
  values (v_uid, p_endpoint, p_plataforma, p_p256dh, p_auth, true, now())
  on conflict (token) do update
    set usuario_id = v_uid, plataforma = excluded.plataforma,
        p256dh = excluded.p256dh, auth = excluded.auth, activo = true, updated_at = now();
end $$;
grant execute on function sgc.registrar_web_push(text,text,text,text) to authenticated, service_role;

create or replace function sgc.eliminar_web_push(p_endpoint text)
returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
begin
  update sgc.device_tokens set activo = false, updated_at = now()
  where token = p_endpoint and usuario_id = auth.uid();
end $$;
grant execute on function sgc.eliminar_web_push(text) to authenticated, service_role;

-- 3) send_push — fan-out a los DOS canales (FCM + Web Push) ───────────────────
-- Igual que el original salvo que ahora dispara también send-web-push para las subs
-- web. Best-effort por canal (cada net.http_post en su propio bloque). Android idéntico.
create or replace function sgc.send_push(
  p_user_ids uuid[], p_titulo text, p_cuerpo text, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_secret text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'infra_sync_secret';

  -- Canal A — FCM/Android: solo si hay algún token FCM (p256dh NULL).
  if exists (
    select 1 from sgc.device_tokens dt
    where dt.activo and dt.usuario_id = any(p_user_ids) and dt.p256dh is null
  ) then
    begin
      perform net.http_post(
        url := 'https://fzfrnrvndzrjwyvdpkgg.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
        body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'titulo', p_titulo,
                                   'cuerpo', p_cuerpo, 'data', coalesce(p_data,'{}'::jsonb))
      );
    exception when others then null; end;
  end if;

  -- Canal B — Web Push/VAPID (CF4c): solo si hay alguna suscripción web (p256dh NOT NULL).
  if exists (
    select 1 from sgc.device_tokens dt
    where dt.activo and dt.usuario_id = any(p_user_ids) and dt.p256dh is not null
  ) then
    begin
      perform net.http_post(
        url := 'https://fzfrnrvndzrjwyvdpkgg.supabase.co/functions/v1/send-web-push',
        headers := jsonb_build_object('Content-Type','application/json','x-sync-secret', coalesce(v_secret,'')),
        body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'titulo', p_titulo,
                                   'cuerpo', p_cuerpo, 'data', coalesce(p_data,'{}'::jsonb))
      );
    exception when others then null; end;
  end if;
end $$;

-- 4) Trigger de versión publicada — UNIFICADO (supersede cf4b) ────────────────
-- Push: a quien tenga FCM O suscripción web (send_push rutea cada canal).
-- Inbox: ésos ∪ usuarios con plataforma ios* (PWA que aún no suscribió al push).
create or replace function sgc.trg_app_version_push()
returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $$
declare v_push uuid[]; v_inbox uuid[]; v_titulo text; v_msg text;
begin
  if coalesce(new.plataforma,'') <> 'movil' then return new; end if;
  if not coalesce(new.publicada,false) then return new; end if;
  if new.push_notificada_at is not null then return new; end if;

  v_titulo := 'Nueva actualización disponible';
  v_msg := coalesce(nullif(new.titulo,''), 'Versión ' || new.version) || ' — toca para actualizar.';

  -- Audiencia de PUSH: cualquier dispositivo con token activo (FCM o sub web).
  select array_agg(distinct dt.usuario_id) into v_push
  from sgc.device_tokens dt where dt.activo;

  -- Audiencia de INBOX: la de push ∪ usuarios de iPhone (PWA) sin sub todavía.
  select array_agg(distinct uid) into v_inbox from (
    select dt.usuario_id as uid from sgc.device_tokens dt where dt.activo
    union
    select u.id as uid from sgc.usuarios u where u.activo and u.plataforma ilike 'ios%'
  ) s;

  if v_inbox is not null and array_length(v_inbox,1) > 0 then
    insert into sgc.notificaciones (usuario_id, tipo, titulo, mensaje, ruta, referencia_tipo)
    select uid, 'version_publicada', v_titulo, v_msg, null, 'version'
    from unnest(v_inbox) uid
    where sgc.notif_permitida(uid, 'version_publicada');
  end if;

  if v_push is not null and array_length(v_push,1) > 0 then
    perform sgc.send_push(v_push, v_titulo, v_msg,
      jsonb_build_object('tipo','version_publicada','ruta','/actualizar',
                         'referencia_tipo','version','version', new.version));
  end if;

  new.push_notificada_at := now();
  return new;
end $$;

commit;
