# CF4c — Web Push real para iOS/PWA (paquete para el PADRE/SGC)

Monta **Web Push estándar (VAPID)** para que los **iPhone (PWA instalada, iOS 16.4+)** y
cualquier navegador reciban notificaciones push reales — hoy el push es solo FCM/Android.
El cliente (app **hijo**, 2.42.0) ya está listo: suscribe con la Push API + `SwPush` y
llama `registrar_web_push`. Falta el backend (esto) + los secretos.

> Reglas 18 (dev→prod) y 19 (todo versionado). Aplicar **primero en dev**, probar en
> `app-dev.` con un iPhone, y recién con OK de Xaviel ir a prod.

## Arquitectura (por qué así)
- **VAPID nativo**, no FCM-web: las llaves las generó el hijo (sin consola de Firebase),
  y sirve a iOS (`web.push.apple.com`) y a todos los navegadores. Angular `ngsw` ya
  maneja el evento `push` y pinta la notificación desde `{ notification: {…} }`.
- **Reutiliza `device_tokens`**: una suscripción web = `(token=endpoint, p256dh, auth)`,
  `plataforma ∈ {ios, web}`. Un token FCM/Android tiene `p256dh = NULL`.
- **`send_push` rutea por canal**: FCM (`p256dh NULL`) → `send-push`; web (`p256dh NOT
  NULL`) → `send-web-push`. Aditivo: Android queda igual.

## Archivos del paquete
- `migration.sql` — columnas + `registrar_web_push`/`eliminar_web_push` + `send_push`
  fan-out + `trg_app_version_push` unificado (**supersede `../2026-10-05-cf4b-...sql`**;
  aplicar cf4c en vez de cf4b, o cf4c después — su CREATE OR REPLACE gana).
- `send-web-push.index.ts` — edge nuevo (VAPID). Copiar a `supabase/functions/send-web-push/index.ts`.

## Pasos de despliegue (DEV primero)

### 1) Secretos VAPID (Xaviel / quien tenga la consola de Supabase)
Las llaves están en el `.env.local` del hijo (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` /
`VAPID_SUBJECT`). La **pública** ya va en el cliente (`environment.vapidPublicKey`); la
**privada es secreto** del edge. Mismo par para dev y prod.
```bash
# DEV (sgc-dev):
supabase secrets set --project-ref fzfrnrvndzrjwyvdpkgg \
  VAPID_PUBLIC_KEY='BPW0Blr5HEElDCEF4nKV3BEKjcQjUhwNC0ufTZJwp0htDx6dGswTxIFb9w-C1xn_OHCeTFNzCUwr7gkPcg8M7aY' \
  VAPID_PRIVATE_KEY='<VAPID_PRIVATE_KEY de .env.local>' \
  VAPID_SUBJECT='mailto:tecnologia@constructorasd.com'
# (INFRA_SYNC_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ya existen para send-push.)
```

### 2) Migración SQL (la aplica el PADRE, regla 19)
En `migration.sql`, reemplaza `{{PROJECT_REF}}` por el ref del entorno
(**dev** `fzfrnrvndzrjwyvdpkgg` / **prod** `jeeqhgccqefbqilntcpu`) y aplícala con el
ledger del padre `--env dev` primero.

### 3) Edge `send-web-push`
Copiar `send-web-push.index.ts` → `supabase/functions/send-web-push/index.ts`.
En `supabase/config.toml` añadir:
```toml
[functions.send-web-push]
verify_jwt = false
```
Desplegar: `supabase functions deploy send-web-push --project-ref <ref>`.

### 4) Editar el edge EXISTENTE `send-push` (1 línea, imprescindible)
`send-push` hoy selecciona TODOS los tokens activos del usuario. Tras cf4c, eso incluiría
las subs web → intentaría FCM contra un endpoint web y lo marcaría muerto (rompe el web).
En su query de tokens, añadir el filtro para que solo tome tokens FCM:
```ts
// supabase/functions/send-push/index.ts — al seleccionar device_tokens:
.eq('activo', true)
.is('p256dh', null)   // ← CF4c: ignorar suscripciones Web Push (las manda send-web-push)
```

## Prueba (dev)
1. iPhone (iOS 16.4+): abrir `app-dev.sgcconstructorasd.com` en Safari → **Compartir →
   Agregar a inicio**. Abrir la PWA desde el ícono.
2. Perfil → **Notificaciones en este dispositivo → Activar notificaciones** → aceptar el
   permiso de iOS. Debe aparecer "activas". Verifica la fila: `select plataforma, p256dh
   is not null as web from sgc.device_tokens where usuario_id = auth.uid()`.
3. Disparar un push: publicar una versión de prueba, o
   `select sgc.send_push(array['<uid>']::uuid[], 'Prueba', 'Hola iPhone', '{}'::jsonb);`
   → debe llegar la notificación al iPhone con la PWA cerrada.
4. Tocar la notificación → abre la app en la ruta del deep-link.

## Notas
- iOS **exige la PWA instalada** (home screen) + el permiso pedido en un gesto. El cliente
  ya lo respeta (botón en Perfil) y, sin instalar, muestra la pista de "agregar a inicio".
- `web-push` (npm) corre en Deno/Supabase por node-compat; si diera guerra, cambiar a
  `jsr:@negrel/webpush` (misma lógica, Deno-native).
- Una sub web que caduca (404/410) se desactiva sola (igual que los tokens FCM muertos).
