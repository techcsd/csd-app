-- BK1 (app) — Estado de notificaciones del usuario actual, MEZCLADO en UNA lectura:
--   • catálogo de tipos           → sgc.notif_tipo (padre PROMPT-36 F1.1)
--   • su preferencia propia        → sgc.notif_pref_usuario (AT23 / "lo apagué yo")
--   • si Administración lo apagó    → sgc.notif_regla vía notif_regla_habilitado()
--
-- El padre expuso notif_tipos_catalogo() y notif_regla_habilitado(uid,tipo) por
-- SEPARADO. La pantalla de Avisos de la app necesita, por tipo, distinguir
-- "lo apagué yo" de "lo apagó Administración" — sin hacer N llamadas (una por tipo).
-- Este RPC lo une en una sola fila-por-tipo. Aditivo, SOLO LECTURA, security definer
-- acotado al propio uid (auth.uid() respeta el JWT del llamador aun siendo definer).
--
-- PARIDAD (regla #5): la web (ajustes-notificaciones) HOY no muestra el estado de
-- Administración; conviene adoptar esta misma lectura allá. Documentado en HANDOFF.

create or replace function sgc.mis_notif_estado()
returns table(
  tipo                    text,
  etiqueta                text,
  descripcion             text,
  es_operativa            boolean,
  orden                   int,
  silenciado_por_mi       boolean,
  deshabilitado_por_admin boolean
)
language sql stable security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select t.tipo, t.etiqueta, t.descripcion, t.es_operativa, t.orden,
         coalesce(np.silenciado, false) as silenciado_por_mi,
         -- notif_regla_habilitado devuelve NULL (sin regla), true (forzado on) o
         -- false (Administración lo apagó). Solo el false es "deshabilitado".
         coalesce(sgc.notif_regla_habilitado(auth.uid(), t.tipo) = false, false)
           as deshabilitado_por_admin
    from sgc.notif_tipo t
    left join sgc.notif_pref_usuario np
      on np.usuario_id = auth.uid() and np.tipo = t.tipo
   where t.activo
   order by t.orden, t.tipo;
$function$;

grant execute on function sgc.mis_notif_estado() to authenticated, service_role;
