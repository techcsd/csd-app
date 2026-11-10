# Release 2.67.0

- **Equipo/dispositivo:** teléfono Android real de Xaviel (actualización in-app
  desde la build dev publicada).
- **Versión de origen:** 2.66.3 (la publicada en prod).
- **Qué se probó:**
  - [x] Tap de push de "recordatorio de grupo" (`wa_recordatorio`) → abre Compa con
        "¿Qué me falta de los grupos?" ya escrito en el composer (no se envía solo).
  - [x] Tap de push de "recap" (`wa_recap`) → abre Compa con "¿Qué se decidió ayer en
        mis grupos?" ya escrito.
  - [x] Tap de la campana (bandeja de Avisos) sobre un aviso de cualquiera de los dos
        tipos → mismo destino que el push (una sola función, `notifAppRoute`).
  - [x] Avisos → ajustes: silenciar "Recordatorios de grupos de WhatsApp" (o
        "Resumen de grupos de WhatsApp") → ese tipo deja de aparecer en la bandeja y
        de sonar/mostrarse como push.
  - [x] Compa: tocar la sugerencia "¿Qué me falta de los grupos?" con un hallazgo
        asignado (`responsable_id` = este usuario) → responde solo lo propio.
  - [x] Compa: la misma pregunta sin pendientes asignados → respuesta clara de "no
        tienes pendientes detectados" (no un error).
  - [x] Cambiar un rol/permiso del usuario en Roles (web) mientras la app está
        abierta en segundo plano → al volver a primer plano (>60 s después), el menú
        ya refleja el cambio sin tener que cerrar sesión (DL-33/139 F4b).
- **Resultado:** OK — Xaviel confirmó en conversación (2026-11-10) que probó la
  actualización in-app en un teléfono Android real desde 2.66.3 y que todo el
  checklist de arriba funcionó.
- **Fecha:** 2026-11-10.

OK: Xaviel, 2026-11-10 — "sure do it" tras confirmar prueba en teléfono Android real, todo el checklist OK. Autoriza continuar el pipeline a main/prod.
