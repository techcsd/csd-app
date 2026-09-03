# BG (PROMPT-29 F3) — Rescate de las bitácoras reales atascadas del ingeniero

> **El criterio de éxito de la tanda.** Un ingeniero tiene bitácoras reales de sus obras
> atascadas en el outbox de su teléfono desde el **20-ago (10 fotos)**, el **25-ago (3 fotos)**
> por RLS, y una tercera (**~18 h antes del 03-sep, 10 fotos**) por `varchar(50)`. La data
> sigue en SU teléfono (Dexie: `outbox` + `fotos_pendientes`) — nunca se perdió.

## ⚠️ Corrección (BI1, 03-sep): la causa real era Storage, no la bitácora
La versión anterior de este doc afirmaba que "el flujo pasa" apoyándose en un smoke que
**nunca probaba un reintento** — insertaba en rutas NUEVAS y hacía rollback (el único camino
que siempre funcionó, el INSERT). Dio verde mientras el reintento seguía roto. **La causa
real, verificada:** el bucket `sgc-bitacora` era el ÚNICO de los buckets de campo sin
política **UPDATE** en `storage.objects`. La app sube las fotos con `upsert:true` a rutas
deterministas (`${id}/foto_${i}.jpg`); el 1er intento entra (INSERT), pero **todo reintento
re-sube la misma ruta → UPDATE → sin política, RLS lo niega**. El reintento moría en la
foto #1, antes de llegar a la bitácora. Cerrado por `SGC/sql/2026-09-03-bi1-bitacora-storage-update.sql`.

## Lo que ya está resuelto (backend, en prod)
- **Storage UPDATE (BI1)**: `sgc-bitacora` ya tiene su política UPDATE (+ auditadas las 10
  buckets con upsert; se cerraron además `sgc-documentos` y `sgc-rrhh`). Verificado con el
  smoke que **reintenta** (`SGC/scripts/smoke-bitacora-app-prod.mjs`, ahora corre dos pasadas
  sobre la misma ruta y exige que la 2ª pase) y con un re-upload real como ingeniero de campo.
- **RLS de bitácora**: `crear_bitacora_app` (DEFINER) siempre pasó — su gate es
  `tiene_modulo('bitacora')`, agnóstico de rol. Nunca fue el problema.
- **varchar**: `bitacora_actividades.estructura` ampliada a **200** (BG). `bloque_entrepiso`
  ampliado a **200** en BI2 (`SGC/sql/2026-09-03-bi2-bloque-entrepiso-200.sql`).
- **Idempotencia**: `crear_bitacora_app` es idempotente por `p_id` (client UUID) → un
  reintento tras un fix **no duplica** aunque un intento previo haya escrito a medias.
- **Fotos ya rescatables**: las 3 bitácoras atascadas de Jonathan Roman tienen sus fotos ya
  en Storage (folders huérfanos `63fa7138…`/6, `bda603c7…`/2, `1a35f057…`/10). El reintento
  desde su teléfono (app ≥ la que ofrece el reintento, PROMPT-33) las graba referenciando
  esas rutas — **sin re-subir bytes perdidos**.

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
