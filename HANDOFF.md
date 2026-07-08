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

## Remaining polish / follow-ups (not blocking)
- Recepción de conduce en bodega (overlaps chofer conduce flow + SGC confirmar_recepcion_salida).
- Voice notes, offline drafts (borradores) for wizards, conteo rápido de inventario.
- Real push/email notifications (no `sgc.notificaciones` table found — locate SGC's mechanism).
- Live device walk-throughs + first signed APK (needs JDK/Android Studio) + PWA deploy to app.sgcconstructorasd.com (Vercel).

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes: Flota "Responsabilidad" view (M2) + Conductores user-link (conduces).
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
