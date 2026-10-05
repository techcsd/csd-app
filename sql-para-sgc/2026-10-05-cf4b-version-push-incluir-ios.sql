-- ============================================================================
-- CF4b (para el PADRE/SGC) — trg_app_version_push debe notificar también a iOS (PWA)
--
-- HALLAZGO (hijo, sesión 2026-10-05, verificado en prod jeeqhgccqefbqilntcpu):
--   Al publicar app móvil 2.41.0, el trigger `sgc.trg_app_version_push` creó la
--   notificación in-app SOLO para usuarios con token android (13) e hizo push FCM a
--   esos tokens. Los usuarios de iPhone (PWA) — `usuarios.plataforma = 'ios-pwa'`,
--   10 reales y activos — NO recibieron NADA (iOS no tiene tokens push en el sistema:
--   `device_tokens` solo tiene filas android). Solo verían el banner al abrir la PWA.
--
-- CAUSA: la audiencia del inbox se deriva de `device_tokens.plataforma='android'`
--   (ver sql/2026-09-07-bk1-notif-panel-core.sql, función trg_app_version_push). Como
--   iOS no registra tokens, queda fuera tanto del push como del inbox in-app.
--
-- MITIGACIÓN YA APLICADA (one-off, regla 19): el hijo insertó la MISMA notificación
--   in-app para los 10 ios-pwa de 2.41.0 vía
--   scripts/data-fixes/2026-10-05-cf4-notificar-ios-2.41.0.mjs (idempotente,
--   respeta notif_permitida). Esto arregla 2.41.0 pero NO las próximas versiones.
--
-- ARREGLO PERMANENTE: que el trigger separe los dos canales —
--   • PUSH (send_push): solo android (único canal con tokens). Sin cambio.
--   • INBOX (notificaciones): android-con-app UNION usuarios con plataforma ios* (PWA).
--   Así cada publicación futura notifica el inbox de iPhone sin depender de tokens.
--   (El día que exista Web Push para iOS, se añade a device_tokens y el push los cubre.)
-- Aditivo e idempotente (CREATE OR REPLACE del cuerpo del trigger; sin cambios de firma).
-- ============================================================================
begin;

create or replace function sgc.trg_app_version_push()
returns trigger language plpgsql security definer set search_path to 'sgc', 'pg_temp'
as $function$
declare v_push uuid[]; v_inbox uuid[]; v_titulo text; v_msg text;
begin
  if coalesce(new.plataforma,'') <> 'movil' then return new; end if;
  if not coalesce(new.publicada,false) then return new; end if;
  if new.push_notificada_at is not null then return new; end if;

  v_titulo := 'Nueva actualización disponible';
  v_msg := coalesce(nullif(new.titulo,''), 'Versión ' || new.version) || ' — toca para actualizar.';

  -- Push: solo tokens android (único canal con infraestructura de tokens).
  select array_agg(distinct dt.usuario_id) into v_push
  from sgc.device_tokens dt where dt.activo and dt.plataforma = 'android';

  -- Inbox in-app: android con app  ∪  usuarios de iPhone (PWA, sin tokens).
  select array_agg(distinct uid) into v_inbox from (
    select dt.usuario_id as uid
      from sgc.device_tokens dt where dt.activo and dt.plataforma = 'android'
    union
    select u.id as uid
      from sgc.usuarios u where u.activo and u.plataforma ilike 'ios%'
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
end $function$;

commit;
