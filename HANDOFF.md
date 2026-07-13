# HANDOFF — CSD App

_Last updated: 2026-07-12_

## Reunión 07/07/2026 — Parte B (branch `feat/meet-07072026`, build green) 🚧 pendiente device-QA + publish
Mobile side of the 07/07 meeting. DB is shared with SGC web; RPCs already exist there.
- **Renombres UI** (solo labels): "Solicitudes/Pedir materiales" → **Requisición/Nueva requisición** (home tile, hub, pedir, mis); "Bodega" → **Almacén** (existencias/salida/entrada/conteo). Estados de requisición SIN cambio (la app ya conoce pendiente/aprobada/entregada/rechazada; NO exponer compras/montos al chofer).
- **Checklist de pre-uso vehicular** (nuevo): `pages/transporte/preuso/:vehiculoId` — wizard plantilla → ítems OK/Falla/N-A por sección (marca crítico + foto en NO) → km/obs → firma → resumen. Servicio `checklist-preuso.service` mirror de `vehiculos.service` (outbox offline, idempotente por UUID) → RPC `registrar_checklist_vehiculo` (ya existe en `sgc`). Handler registrado en `app.config`. Botón en el hub de Transporte.
- **NO** se agregó nada de cuadres/límites/alertas/montos ni Tecnología/Expediente (prohibido para campo).
- **Pendiente:** device-QA (offline + online), y **bump de versión + build/publish del APK** (paso de Xaviel — requiere dispositivo). No se subió versión aún.

_Last updated: 2026-07-11 (below)_

## v1.1.3 — interactive spotlight tour (both systems), device-verified + published ✅
The first-run guide now **shows** instead of only telling: it dims the screen and spotlights each real UI element as it explains it.
- **Web (SGC)**: `onboarding-web` rewritten as a tour — welcome → sidebar → pending badges → CSD App link → Soporte → profile → done. Anchored via `data-tour` attrs + `tourKey()` in the shell. Replayable from Soporte ("Ver la guía de bienvenida"). Browser-verified (rings the real sidebar / each nav item; centered fallback when a target is absent).
- **App (CSD)**: `shared/components/onboarding` rewritten as a spotlight tour on Home — welcome → tiles → sync bar (verde/amarillo) → profile → done. Anchored via `data-tour` on the grid, `<app-sync-bar>`, and the Perfil button. Replay from "Soporte y ayuda". **Device-verified** end-to-end (v1.1.3): each element ringed in orange, callout positioned above/below, dismisses clean.
- Same spotlight technique both sides (box-shadow dim + measured getBoundingClientRect + on-resize re-measure). **Published v1.1.3** (code 10).


## v1.1.2 round — skeletons, sign-out confirm, full audit trail (both systems) ✅
- **Audit trail (traceability)** — `sql/2026-07-11-auditoria.sql`: `sgc.auditoria` + a generic `fn_auditoria()` AFTER trigger attached to **55 business tables**. Captures every INSERT/UPDATE/DELETE with the real actor (`auth.uid()`), a before→after diff (UPDATE), and the row (INSERT/DELETE). DB-level ⇒ catches **web AND app** writes automatically (app RPCs are SECURITY DEFINER but keep the caller's JWT). RLS: readable by `is_admin() or tiene_modulo('auditoria')`. `auditoria_actores()` RPC feeds the user filter. Verified non-destructively (trigger logs exact diff + actor, rolls back).
  - **Web viewer**: SGC Admin → Auditoría (`pages/admin/auditoria`, `auditoria.service`) — filter by usuario/área/acción/fecha + search, server-side `.range()` pagination, expandable diffs. Device/browser-verified.
  - **App viewer**: CSD Admin → Auditoría (`pages/admin/auditoria`, `AdminService.getAuditoria`) — filter chips + load-more + expandable diffs. Device-verified (caught a real "Modificó Catálogo · Activo Sí→No" by Xaviel).
- **Skeleton loaders** — SGC `shared/components/skeleton` (table/list/cards) on 8 main list pages; CSD `shared/ui/skeleton` on all data screens (transporte, conduces, existencias, conteo, recibir, mis-solicitudes, mis-partes, detalle, admin/*). Replaces blank pages / bare "Cargando…".
- **Sign-out confirmation** — SGC `shared/components/confirm-dialog` on the header logout; CSD `shared/ui/confirm-dialog` on Perfil → Cerrar sesión. Both device/browser-verified.
- **Published**: versionCode 9 / **v1.1.2**. Both repos pushed; SGC → Vercel.
- Note: audit `sgc.auditoria` starts empty and fills with real activity going forward (synthetic demo rows were purged).


## Web parity round — conduce evidence tested + all app media now visible in web ✅
Rule reinforced: the app is a **child of the web** — anything captured on the app must be viewable in SGC. Audited every app write; closed the media gaps. All verified in a real browser (Edge headless, session minted via admin magic-link OTP + localStorage injection against the SGC dev server):
- **Conduce delivery evidence** — seeded real photo+firma into the `conduces` bucket, confirmed the SGC conduce view renders "Recibido en obra por / Entrega registrada por {chofer}" + the delivery photo & signature. Test data reverted.
- **Web first-run guide** — `SGC/src/shared/components/onboarding-web` (5 slides, skippable "Saltar guía"). Shows once for **non-admin** users on first shell load; **admins skipped** (marked done silently). Flag `sgc_onboarding_v1_done` in localStorage. Verified showing+dismissing for non-admin "Test User 3".
- **Vehicle signature** (`vehiculo_entregas.firma_url`, bucket `vehiculos`) — now signed+rendered in Flota → Responsabilidad. (No prod rows yet to screenshot; compiled + same pattern as the 6 photos already shown.)
- **Bitácora media** — historial detail now renders field photos inline (thumbnails) and incident voice notes with an `<audio>` player (were text links). Verified: 2 inline photos + audio player.
- **Inventario salida/entrada photo** (`foto_path`, bucket `inventario`) — salida capture photo added to the conduce view; entradas list gains a Foto column with a 📷 button (signed URL). Verified entrada foto button.
- Testing note: `msedge` + `playwright-core` + `admin.generateLink({type:'magiclink'})`→`verifyOtp`→inject `sb-<ref>-auth-token` is a repeatable way to screenshot authed SGC pages headlessly. Installed/removed per-test; not committed.


## v1.1.1 round — portrait lock, onboarding, conduce evidence in web (device-verified) ✅
- **Portrait lock**: `MainActivity android:screenOrientation="portrait"` — fixes the landscape PIN-pad overflow (keys 7/8/9/0 off-screen). Verified on device.
- **First-run onboarding**: `shared/components/onboarding` — 4 skippable full-screen slides (sin señal / fotos+firma / barra de estado) shown once on Home; flag `csd_onboarding_v1_done` in LocalStore. "Ver tutorial de nuevo" button in Soporte replays it. Device-verified end-to-end (slides → Empezar → dismiss → stays dismissed).
- **On-device smoke test** (v1.1.x, device 6dbf1af4): Admin hub (4 tiles) ✓, Catálogos add+desactivar against live DB ✓, Perfil (Admin badge) ✓, Soporte FAQ ✓.
- **SGC web gap closed** (keep-both-in-sync): the app closes conduces with a delivery photo + receiver + signature via `sgc.entregar_conduce`. The web conduce view (`pages/inventario/conduce`) now shows *Recibido en obra por*, *Entrega registrada … por {chofer}*, and renders the delivery photo + signature via signed URLs from the private `conduces` bucket. Model + `salidas.service` SELECT extended with `entregado:usuarios!..entregado_por_fkey(nombre)`. Committed+pushed to SGC `main` (Vercel auto-deploy).
- **Published**: versionCode 8 / **v1.1.1** built, signed, uploaded to `app-releases` (apk + latest + version.json). csd-app `main` pushed.


## Where we are
**M1 (Fundaciones) DONE. M2 (Transporte) — vehicle-responsibility checklist DONE.** Build passes (156 kB initial transfer). Pushed to `origin/main`.

M2 backend applied to prod + verified non-destructively (RPC enforces auth, `flota` module, the 6 required photos, and the "one responsible" rule; happy path inserts custody + updates vehicle; rolled-back test left 0 rows):
- `sgc.vehiculo_entregas` / `_fotos` / `_danos` (append-only, RLS read-only, unique-partial index)
- RPCs `crear_entrega_vehiculo` (idempotent), `vehiculo_estado_actual`, `mis_pendientes_transporte`
- Storage buckets `vehiculos`, `conduces`
Frontend: Transporte hub (a cargo / por recibir) + 6-step checklist wizard (6 guided photos → km+combustible → daños → firma → resumen), enqueued offline via the `vehiculo_entrega` sync handler (registered at bootstrap).

## Done
- **Scaffold**: Angular 21 (standalone, zoneless) + Capacitor 8 + Angular PWA (service worker + manifest). Android platform added under `android/`.
- **Env**: `src/environments/*` point at the SGC Supabase project (same anon key). Prod file-replacement wired in `angular.json`. Secrets in gitignored `.env.local`.
- **Design system** (`shared/ui`): big-button, option-button, counter, photo-slot (Capacitor camera + web fallback, JPEG compression), step-bar, big-confirm (haptic), signature-pad, sync-badge, pin-pad. Tokens in `styles.scss` (UI/UX doc).
- **Core**: SupabaseService (Preferences-backed session on native), AuthService, PinService (PBKDF2 hash, 5-try lockout), LocalStore, UserContextService (roles→módulos, mirrors SGC), SessionService (boot flow), NetworkService (signal), CameraService, ToastService.
- **Offline engine**: Dexie DB (`core/db/app-db.ts`), CatalogService (read-through cache + storage.persist), SyncService (outbox FIFO, photo→RPC, backoff 30s→5min×6, pending/syncing/done/error, client-UUID idempotency, handler registry).
- **Guards**: authGuard → pinGuard → moduleGuard.
- **Pages**: login, reset, set-password, pin-setup, pin-unlock, home (4 tiles gated by módulos, single-módulo auto-enter), module placeholders (bitácora/transporte/inventario/solicitudes), 403. Global SyncBar + ToastHost.

## Migrations — SOLVED
DDL works via the Management API using the system env var `SUPABASE_ACCESS_TOKEN` (sbp_…, already set on this machine). Use `node scripts/apply-migration.mjs sql/<file>.sql` — runs as postgres. `v_app_mi_contexto` view applied + verified on 2026-07-08. This is the path for M2's `vehiculo_entregas` tables + RPCs.

## Blockers / needs Xavier
1. **Live login walk-through** — needs a real SGC user's password to test login→PIN→home end-to-end. Build/serve/data-shape all verified; the interactive auth path is the one thing I can't self-test.
2. **Android APK** — no JDK/Android SDK on this machine. `android/` project is ready; installing JDK 21 + Android Studio lets us build/sign the first APK + keystore.
3. **Rotate keys** — service_role/secret + other keys passed through chat; rotate after the milestone.

## SGC web — Flota "Responsabilidad" view DONE (needs your commit/push)
Added in `dev/SGC` (builds clean): route `/flota/responsabilidad`, shell nav entry, `VehiculosService.getResponsabilidad()` + `getEntregaFotoUrl()`, and the `Responsabilidad` component (history list, "requieren revisión" filter, expandable photos/signature via signed URLs, damage highlighting). **Not committed** — SGC pushes deploy to Vercel prod, so left for you to review + push.

## M2 conduces — DONE
- Migration `2026-07-08e-conduces.sql` applied: `conductores.usuario_id` FK; delivery-evidence columns on `salidas_inventario`; RPCs `entregar_conduce` (idempotent, reuses despachado→entregado/incompleto), `mis_conduces_hoy`, `mis_rutas_hoy`, `marcar_ruta_estado`. Guard paths verified.
- App: `ConducesService` (+ `conduce_entrega` sync handler, registered at bootstrap); Transporte hub → "Mis conduces y rutas" → conduces list (routes with iniciar/completar + conduces) → delivery flow (photo → ¿llegó todo? → partial qty → receiver + signature), offline-first.
- SGC web (`dev/SGC`, uncommitted): Conductores form now links a driver to an app user (`usuario_id`) so `mis_conduces_hoy`/`mis_rutas_hoy` resolve. Builds clean.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes for both M2 features (Flota "Responsabilidad" view + Conductores user-link):
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## Still needs Xavier
1. Live walk-throughs (need a real user password): vehicle checklist + conduce delivery, offline→reconnect→verify in Supabase. For conduces, first link a conductor to a user in SGC and dispatch a salida.
2. Real notifications on `requiere_revision` (no `sgc.notificaciones` table found — locate SGC's mechanism).

## M3 — Bitácora DONE
- Migration `2026-07-08f`: idempotent `sgc.crear_bitacora_app(p_id, …)` (module gate, actividades/restricciones/fotos, usuario_id = auth.uid()). Verified non-destructively (parte_diario inserts header + child rows; module gate rejects non-bitacora users). Photos reuse the existing `sgc-bitacora` bucket. Catalog enums pulled from the real CHECK constraints (estructuras/actividades/restricciones).
- App: `BitacoraService` (+ `bitacora` sync handler at bootstrap); Bitácora hub → parte-diario wizard (obra → personal counters → actividades → problemas → fotos → resumen), incidente short flow (tipo → gravedad → heridos → fotos → nota), and offline "Mis partes" list.

## M4 — Inventario + Solicitudes DONE
- Migration `2026-07-08g`: idempotent app RPCs `registrar_salida_app` (validates stock, fires trg_detalle_salidas_stock), `registrar_entrada_app` (fires detalle_entradas_stock_trigger), `crear_solicitud_app`; `foto_path` columns + `inventario` bucket. Verified non-destructively (entrada bumps stock, solicitud creates pendiente/urgente, salida guard rejects over-stock, 0 rows left).
- App: `InventarioService` + `SolicitudesService` (handlers at bootstrap). Inventario hub → existencias (bodega + search), salida (cart + optional photo), entrada (cart + referencia + photo). Solicitudes hub → pedir (cart + urgencia) + mis solicitudes (status list).

## Milestone status — all feature milestones built
M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅. M5 is piloto/rollout (no app code). The 4 Home modules are all functional end-to-end offline.

## PWA — DEPLOYED ✅
Live at **https://app.sgcconstructorasd.com** (Vercel project `csd-app`, team CSD; GitHub repo connected → push to `main` auto-deploys). `vercel.json` = SPA rewrites + `no-cache` on ngsw-worker.js/ngsw.json/index.html. Verified live: deep-link routes 200, SW no-cache. PWA auto-update wired (UpdateService: VERSION_READY → activate + reload). Perfil screen shows app version (1.0.0) + manual "Buscar actualización" + logout.

## Signed APK — BUILT & PUBLISHED ✅
Android Studio (JDK 21 + SDK) is installed, so the APK builds locally. Release
keystore `android/csd-release.keystore` + `android/keystore.properties`
(gitignored — **BACK THESE UP**; losing them = users reinstall). Signed
`app-release.apk` (7.4 MB, V2-signed) published to the public `app-releases`
bucket + `version.json`. Build/release steps: `scripts/build-apk.md`,
`scripts/release-apk.mjs`. SGC page **CSD App (móvil)** shows APK link + QR + PWA
install. Rebuild: `npx cap sync android && cd android && ./gradlew assembleRelease`
(set JAVA_HOME + ANDROID_HOME per build-apk.md).

## Authenticated E2E — VERIFIED ✅
Real anon-key sign-in → JWT → v_app_mi_contexto (módulos) + mis_pendientes_transporte
+ stock reads all work under RLS (throwaway user, deleted after). Only the on-device
camera/airplane-mode UI walkthrough still needs a physical phone.

## Done this round
Recepción de conduce en bodega (recibir_conduce_app), voice notes (incidente),
offline drafts (parte), solicitud email notification (badge interconnection is
automatic). SGC Flota view + conductor link + APK download page pushed to prod.

## v1.0.1 UX round (device-verified) ✅
Custom CSD icon (adaptive), redesigned PIN pad (device screenshot confirms), "parte"→"bitácora" copy, Mis bitácoras server list + detail (fotos/audio signed URLs), actividades multi-select (estructura×actividad), incidente obra selector fixed + voice note, browsable **ArticuloPicker** (select instead of search) in pedir/salida/entrada, entrada "Referencia"→"¿De dónde viene?" chips, `replaceUrl` on finish (back no longer re-enters filled wizard). v1.0.1/code 2 built, published, installed on device 6dbf1af4.

**Play Protect:** the "unknown developer" prompt is inherent to sideloading (targetSdk 36, signed, minimal perms — already optimal). "Install anyway" is expected/safe; only Play/Managed Google Play removes it.

**On-device deep test blocked on the local PIN** — give me the 4-digit PIN (or a test user's password) and I can drive the full flow via adb + screenshots to hunt bugs. Role gating is verified: Home tiles + routes are filtered by roles.modulos (a chofer sees only Transporte; an all-módulos user sees all — that's correct).

## Done (v1.0.3)
- **Conteo rápido**: `conteos_inventario`/`conteo_items` audit tables + idempotent
  `registrar_conteo_app` (adjusts stock to counted value via adjust_stock). Inventario flow.
- **Incident email alerts**: `notificar-incidente` edge function (deployed) → admin + proyectos
  module holders; app invokes it on incident sync. No-ops if Resend key unset.
- On-device walkthrough done (see v1.0.1/1.0.2 notes); PIN re-lock on resume fixed.

## v1.0.4 (this round)
- **Keystore backed up** to `Projects documentations/CSD App Documentation/KEYSTORE-BACKUP/` (+ LEEME.txt). ⚠️ Still copy it OFF this machine (password manager / cloud / USB).
- **Incident emails enabled/confirmed**: Vault Resend key present, function deployed, recipients = 1 admin + 5 proyectos. Fires on the first real field incident (didn't send a fake test blast).
- **UX**: native obra/bodega dropdowns → tappable `SelectList` (glove-friendly) across pedir/salida/entrada/conteo/existencias.
- **Security**: deactivated-user lockout (cold start + resume). FLAG_SECURE deliberately skipped (would block WhatsApp screenshot-sharing).

## Airplane-mode test — PASSED ✅ (on device 6dbf1af4, v1.0.4)
Offline→reconnect→sync verified end-to-end: cut wifi/data → app showed "Sin señal" →
created a solicitud offline (amber "Guardado · Se enviará solo") → outbox tracked
"1 se enviarán solos" → reconnected → auto-synced ("Todo enviado") → real row landed
in sgc.solicitudes_material (BRISAS CITY CENTER, Xaviel Terrero, pendiente). Interconnection
confirmed (shows in SGC Solicitudes + badge). Offline-first promise proven on a real phone.

## v1.0.5 round (units, incidents, feedback)
- **Units are now admin-managed** (SGC): `sgc.unidades` catalog (seeded from the old hardcoded list) + **Administración → Unidades** (create/rename/activate). The artículo form reads units from the DB. App shows units from the artículo (no app change needed).
- **Incident emails retargeted**: now go to the incident PROJECT's team (proyecto_empleados→empleados→usuarios) + admins, not all PMs company-wide. Redeployed.
- **In-app "Reportar un problema"** (Perfil → SGC reportes_usuario → Administración → Comentarios y Reportes). RLS insert verified.
- v1.0.5 built + published to the download page. ⚠️ Device was unplugged at the end — reinstall to the phone via the download page (or `adb install -r` when reconnected). App was fully on-device tested in prior rounds; this round verified via RLS tests + builds.

## v1.1.0 round — app is a fuller "child of the web"
- **App Admin section** (gated by `admin` module, Home tile + Perfil): Reportes (view/resolve),
  Catálogos de bitácora, Unidades, Historial de conteos. RLS-gated server-side (is_admin).
- **App Soporte/Ayuda** page (FAQ + reportar), linked from Perfil.
- **Bitácora catalogs now admin-managed** (`sgc.bitacora_catalogos`; CHECKs dropped). Both the app
  wizard and the SGC nueva-bitácora form load them from the DB (built-in lists = offline fallback).
  Manage in: app Admin → Catálogos, or SGC Administración → Catálogos de bitácora.
- **Conteo/ajuste history**: app Admin → Historial de conteos, and SGC Inventario → Conteos y ajustes.
- v1.1.0 built + published. ⚠️ Device was offline — reinstall via the download page or adb when reconnected.

## Remaining (needs you / optional)
- **Rotate Supabase service_role/secret keys** (dashboard — they passed through chat).
- **Back up the keystore** (`android/csd-release.keystore` + `keystore.properties`).
- Airplane-mode capture→reconnect→sync test on a real device (camera + offline queue).
- Optional: notificar-incidente recipients (currently admin+proyectos) — tune if you want
  project-specific supervisors; set NOTIFICATIONS_FROM_EMAIL + Resend key in Vault to enable email.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes: Flota "Responsabilidad" view (M2) + Conductores user-link (conduces).
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
