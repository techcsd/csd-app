# HANDOFF — CSD App

_Last updated: 2026-07-08_

## Where we are
**Milestone M1 (Fundaciones) — DONE and building.** `npm run build` passes (149 kB initial transfer, well under the 1MB budget). Dev server serves HTTP 200 and every route compiles. Supabase data layer verified against production (`sgc` schema, roles/módulos shape correct).

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

## Next (M2 — Transporte, the biggest pain point)
1. SQL migration: `sgc.vehiculo_entregas` + `_fotos` + `_danos` (RLS, unique-partial "one responsible", grants). Draft to `sql/`.
2. RPCs `crear_entrega_vehiculo`, `vehiculo_estado_actual`, `mis_pendientes_transporte` (idempotent by `p_id`).
3. Vehicle receive/return checklist flow (6 guided photos + km + fuel + damages + signature) using PhotoSlot/SignaturePad, enqueued offline.
4. Register the `vehiculo_entrega` handler with SyncService (upload photos → call RPC).
5. Rutas + conduces del día with delivery confirmation (reuse SGC salidas RPC + p_id).
6. SGC web: vehicle-responsibility history view in Flota (rule #5).

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
