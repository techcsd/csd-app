# HANDOFF — CSD App

_Last updated: 2026-07-08_

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

## Airplane-mode test — PENDING (device was unplugged)
Reconnect the phone (USB, debugging on) and tell me — I'll: unlock → turn off wifi/data via adb → create a capture offline (shows ⏳ pending) → reconnect → confirm it syncs (✅) + lands in Supabase. Also I'll reinstall v1.0.4 (currently only published to the download page, not yet on the device).

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
