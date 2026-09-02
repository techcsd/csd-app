# BG (PROMPT-29 F3) — Rescate de las bitácoras reales atascadas del ingeniero

> **El criterio de éxito de la tanda.** Un ingeniero tiene bitácoras reales de sus obras
> atascadas en el outbox de su teléfono desde el **20-ago (10 fotos)**, el **25-ago (3 fotos)**
> por RLS, y una tercera (**~18 h antes del 03-sep, 10 fotos**) por `varchar(50)`. La data
> sigue en SU teléfono (Dexie: `outbox` + `fotos_pendientes`) — nunca se perdió.

## Lo que ya está resuelto (backend, PROMPT-28, en prod)
- **RLS de bitácora**: el flujo `crear_bitacora_app` (DEFINER) pasa para ingeniero de
  campo/oficina y capataz (ver `SGC/scripts/smoke-bitacora-app-prod.mjs`).
- **varchar**: `bitacora_actividades.estructura` ampliada a **200** (verificado en prod).
- **Idempotencia**: `crear_bitacora_app` es idempotente por `p_id` (client UUID) → un
  reintento tras un fix **no duplica** aunque un intento previo haya escrito a medias.

## Lo que aporta la app (PROMPT-29, este cambio)
- **Categoría 'sistema'** en el outbox: conserva indefinidamente, mensaje honesto
  ("problema del sistema — reportado a Tecnología"), **Descartar escondido** tras doble
  confirmación. El reintento manual siempre disponible re-envía el **payload íntegro +
  fotos** (siguen en `fotos_pendientes`).
- **Banner de reintento sugerido**: cuando Tecnología publica el fix (`publicar_fix_outbox`),
  la app muestra "Hay una corrección que puede resolver tus N pendientes — ¿reintentar?".
- **F5**: contador/límite de 200 en el texto de estructura → el `varchar` no vuelve a
  reventar en pantalla.

## Procedimiento del rescate (CON el ingeniero)
1. **Publicar el APK** de esta ronda y **forzarle/pedirle la actualización** al ingeniero
   (su APK viejo muestra el mensaje incorrecto "no tienes permiso" + Descartar prominente).
2. **Publicar las señales de fix** (Tecnología), para que su app le sugiera el reintento:
   ejecutar `scripts/apply-migration.mjs sql/2026-09-02-bg-publicar-fixes-rescate.sql`
   **ajustando `min_app_version` a la versión publicada del APK** (así solo las apps con
   este código actúan).
3. En su teléfono, en **Pendientes de envío**: aparece el banner → **"Reintentar ahora"**
   (o entra a cada pendiente y toca **Reintentar**). Con red, se suben las fotos y
   `crear_bitacora_app` las graba (idempotente).
4. **Verificar CON él** que las **3** bitácoras llegaron **completas** — campos, renglones
   y **todas las fotos (10 + 3 + 10)** — y que **se ven en la web** (SGC · Bitácora).
5. **No descartar nada** hasta que él confirme. Si algún reintento vuelve a fallar:
   vía B = **BG3** (abrir el pendiente → **Duplicar a nueva bitácora** con fotos, o
   **Compartir/exportar** el PDF). **Reportar a Xaviel antes de tocar nada.**

## Telemetría (para que no se repita)
- Al entrar a 'sistema', la app llama `reportar_outbox_atascado` (DEFINER, idempotente por
  dedup_key) → Tecnología recibe alerta + panel `/tecnologia/outbox-atascados`. Nunca más
  se descubre por screenshot dos semanas después.

## Follow-up conocido (no bloquea el rescate)
- `crear_conduce_externo` aún no acepta client-uuid → un reintento podría duplicar un
  conduce externo (contrato BG1 §4). El resto de tipos ya son idempotentes; el retiro se
  cerró en esta ronda (`p_client_id`). Pendiente para una próxima ronda.
