# Release 2.67.0

- **Equipo/dispositivo:** pendiente (teléfono real, Xaviel — PROMPT 139, F5 "pendientes físicos de Xaviel").
- **Versión de origen:** 2.66.3 (la publicada en prod).
- **Qué probar:**
  - [ ] Tap de push de "recordatorio de grupo" (`wa_recordatorio`) → abre Compa con
        "¿Qué me falta de los grupos?" ya escrito en el composer (no se envía solo).
  - [ ] Tap de push de "recap" (`wa_recap`) → abre Compa con "¿Qué se decidió ayer en
        mis grupos?" ya escrito.
  - [ ] Tap de la campana (bandeja de Avisos) sobre un aviso de cualquiera de los dos
        tipos → mismo destino que el push (una sola función, `notifAppRoute`).
  - [ ] Avisos → ajustes: silenciar "Recordatorios de grupos de WhatsApp" (o
        "Resumen de grupos de WhatsApp") → ese tipo deja de aparecer en la bandeja y
        de sonar/mostrarse como push.
  - [ ] Compa: tocar la sugerencia "¿Qué me falta de los grupos?" con un hallazgo
        asignado (`responsable_id` = este usuario) → responde solo lo propio.
  - [ ] Compa: la misma pregunta sin pendientes asignados → respuesta clara de "no
        tienes pendientes detectados" (no un error).
  - [ ] Cambiar un rol/permiso del usuario en Roles (web) mientras la app está
        abierta en segundo plano → al volver a primer plano (>60 s después), el menú
        ya refleja el cambio sin tener que cerrar sesión (DL-33/139 F4b).
- **Depende de (no bloquea esta build, pero sin esto los dos primeros casos no
  tienen datos reales que disparar):** PROMPT 138 F2 (migración
  `2026-11-10-dl3-wa-seguimiento.sql`: tipos `wa_recordatorio`/`wa_recap` en
  `sgc.notif_tipo`) y F7 (`mis_pendientes_de_grupos`, `compa_sugerencias`). Si
  138 no ha corrido aún en dev, los dos primeros casos no se pueden ejercitar con
  datos reales — el código de la app ya está listo y no regresiona (tipo
  desconocido → comportamiento actual, sin cambios).
- **Resultado:** PENDIENTE — no construido ni publicado en ningún entorno todavía
  (regla 18: nada a prod ni build de APK sin el OK de Xaviel; esta ronda se
  detuvo en el worktree `csd-app-dl`, rama `feature/dl-compa-whatsapp-receptor`,
  sin commit).
- **Fecha:** 2026-11-10.
