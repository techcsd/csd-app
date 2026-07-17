# CSD App — App móvil de campo de Constructora SD

Field companion app for the SGC ERP. Android APK (direct install) + installable PWA for iPhone, one Angular 21 + Capacitor codebase. **UI language: Spanish (RD).** Built solo by Xavier (Tecnología) with Claude Code. Full project docs: `C:\Users\xavie\Desktop\X Dev\Projects documentations\CSD App Documentation\md\`.

## Stack
Angular 21 (standalone + signals, zoneless) · Capacitor 8 (Android + camera/filesystem/network/geolocation/preferences) · Dexie (IndexedDB, offline outbox) · signature_pad · Angular service worker (PWA) · **same Supabase project as SGC** (schema `sgc`, same users/roles/RLS). Vercel for the PWA (`app.sgcconstructorasd.com`).

## Commands
- Dev/PWA: `npm start` · Build: `npm run build` (must pass before "done" — SGC rule #4)
- Android: `npm run apk` (build APK firmado + registra versión) → `npm run apk:publish` (sube al bucket). Toolchain instalado: Android Studio JBR (JDK 21) en `C:\Program Files\Android\Android Studio\jbr` + SDK en `%LOCALAPPDATA%\Android\Sdk` (autodetectados por `scripts/build-apk.mjs`). Para abrir en el IDE: `npx cap sync android` → `npx cap open android`.
- Secrets in `.env.local` (gitignored): Supabase URL, anon key, and admin keys.

## The one rule that shapes everything
This app is **not a mini-SGC** — it's a different experience over the *same data*. One button = one job; wizard one-question-per-screen; photo-first; huge targets (≥56px); works 100% offline. Users have low digital literacy, gloves, sun, bad signal. See UI/UX doc §1.

## Architecture
- `core/services` — supabase, auth, pin, local-store, user-context, session, network, camera, toast
- `core/guards` — authGuard → pinGuard → moduleGuard(modulo)
- `core/db/app-db.ts` — Dexie stores: catalogos, outbox, fotos_pendientes, borradores, mis_registros
- `core/sync` — `CatalogService` (read-through cache) + `SyncService` (outbox FIFO, photo→RPC, backoff, states). **Writes go through the outbox, never direct.**
- `shared/ui` — design system: big-button, option-button, counter, photo-slot, step-bar, big-confirm, signature-pad, sync-badge, pin-pad
- `pages` — auth (login/pin/reset/set-password), home (4 gated tiles), + module pages

## Offline-first contract (ADR-002)
Every capture: save to Dexie + enqueue in outbox with a **client UUID** (idempotency). SyncService uploads photos to Storage, then calls the SGC RPC, then marks ✅. Feature services `sync.register(tipo_op, handler)`. Append-only where possible; state transitions validated server-side.

## Hard rules (inherited from SGC — never skip)
1. **Interconnection**: field captures reuse SGC's existing RPCs so notifications/badges/KPIs fire exactly as from the web.
2. **Roles/módulos**: every button/route respects `sgc.roles.modulos` (bitacora/flota/inventario/compras). Same gate as SGC.
3. **DB integrity**: new objects need RLS + schema grants + sequence grants (recurring prod bug). Writes via `security definer` RPCs. RPCs must stay backward-compatible ≥2 versions (field apps update late — ADR/Deployment).
4. **Verify before done**: `npm run build` passes + flow tested offline AND online (airplane mode) + verified in SGC web.
5. **Keep SGC in sync**: if a feature here implies a web view (e.g. vehicle-responsibility history in Flota), build it there too.
6. **Migrations**: the DB is shared with SGC production — coordinate; never break the web.

## Backend / migrations
Apply SQL with `node scripts/apply-migration.mjs sql/<file>.sql` — it POSTs to the Supabase Management API using the system env var `SUPABASE_ACCESS_TOKEN` (sbp_…, runs as postgres → DDL works). Data API keys in `.env.local` (anon / service_role) are for row access from the app, NOT DDL. Every migration: RLS + schema grants + sequence grants; keep RPCs backward-compatible ≥2 versions.

## Versionado / historial (REGLA Y1 — no negociable)
**Cada actualización enviada (web o app móvil) DEBE registrarse en el historial de versiones (`sgc.app_versiones`), automáticamente y SIEMPRE con el mismo formato estructurado.** Formato estándar de una entrada: `version` (semver), `plataforma` (web|movil), `fecha`, `titulo` (corto, opcional) y `cambios[]` donde cada cambio = `{ t: nuevo|mejora|arreglo|seguridad, d: texto }`. La UI del historial pinta chips por tipo para ambas plataformas.
- **App**: `npm run apk` (build) YA **registra la versión al generar el APK** (llama a `scripts/release-apk.mjs --register-only`), y `npm run apk:publish` además sube el APK al bucket. Registran SIEMPRE vía `registrar_version(p_plataforma, p_version, p_notas, p_titulo, p_cambios)` con `cambios[]` estructurados (curados en `CAMBIOS_CURADOS`, o generados de los commits: feat→nuevo, fix→arreglo, perf/refactor→mejora, sec→seguridad). **Ambos FALLAN (exit 1) si no pudieron registrar** — así ninguna versión se escapa del historial. Mantener `VERSION` (en `release-apk.mjs`) alineado con `src/environments/*` y `android/app/build.gradle`. La pantalla de Perfil/Ajustes muestra la versión **instalada** (`environment.version`) + aviso si hay una publicada más nueva.
- **Web**: el registro corre en cada deploy a `main` (hook de build/CI); el auto-registro al arrancar la app queda como red de seguridad (idempotente).
- Publicar/forzar mínima al usuario es un paso aparte del admin en SGC (flags `publicada`/`minima`); registrar en el historial NO publica.

## Status
M1 (Foundations) complete: scaffold, auth+PIN, offline engine, design system, Home gating, PWA. See HANDOFF.md.
