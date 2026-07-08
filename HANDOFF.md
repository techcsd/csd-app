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

## Next (rest of M2)
1. **Rutas + conduces del día** (delivery confirmation) — BLOCKED on a modeling decision: `rutas.conductor_id` and `salidas` point at `sgc.conductores` (a catalog with no `usuario_id`), but app users are `sgc.usuarios`. Need: is there a usuario↔conductor link, or should the app match by cédula/name, or should conduces be assignable to usuarios? Ask Xavier before building.
2. **SGC web** (`dev/SGC`): vehicle-responsibility history in the Flota module reading `vehiculo_entregas` (+ highlight `requiere_revision`). Doable solo — keeps both apps in sync (rule #5).
3. Live login walk-through of the full offline checklist (needs a real flota user's password): capture in airplane mode → reconnect → confirm row + photos in Supabase.
4. Real notifications on `requiere_revision` once SGC's notification mechanism is located (no `sgc.notificaciones` table found).

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
