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

## Roles / gating (app)
Los roles/módulos vienen de la BD (`usuarios_roles → roles(codigo, modulos, permisos)`); el gating es **data-driven** (`hasModulo`/`puedeVerSubmodulo`/`puedeOperarSubmodulo`) + unos predicados en `core/services/user-context.service.ts` que **espejan funciones del servidor** (nunca inventar la lista; copiarla del SGC):
- `esDesarrollador()` ↔ `sgc.es_rol_desarrollador()` = `admin | tecnologia | encargado_tecnologia | desarrollador`. Gate de 🩺 Código, detalle técnico de errores y **Dev notes** (la RLS de `notas.ambito='dev'` es esta, NO es_tecnologia).
- `esTecnologia()` ↔ `sgc.es_tecnologia()` = `admin | tecnologia | gerencia | direccion | desarrollador`. **Es POR ROL, NO por módulo** (gotcha: tener el módulo `tecnologia` NO la hace verdadera). Gate de *Reportes de errores* + marcar versión.
- `esFlotaElevado()` ↔ `sgc.es_flota_elevado()` = `admin | direccion | gerencia | jefe_flota | logistica`.
- **Rol Developer** (`desarrollador`, id 35, `es_operativo=false`): `modulos=['tecnologia']` + `ver` granular en submódulos operativos (flota.*, inventario.*, compras.*, proyectos.*, bitacora.ver_todas). Ve Tecnología/Sistema (Dev notes, versiones, errores) y lee lo operativo para depurar; **NO** escribe datos de obra (regla 4: los botones de captura no se pintan — sin módulo `flota` no ve Transporte/Registrar combustible; "Nueva requisición"/FAB de personal gatean por `operar`, que no tiene). QA: `qa-desarrollador@dev.constructorasd.local` (dev) / `qa_desarrollador@constructorasd.com` (prod). Backend: SGC `sql/2026-09-23-bx1-rol-desarrollador.sql` + `bx1b` (es_tecnologia), ambos en dev+prod.

## Regla 18 — dev → prod (BU1, no negociable)
**Nada llega a producción sin haber vivido y probado en dev primero — y los scripts lo hacen cumplir.** Hay **dos entornos**: `prod` (proyecto Supabase `jeeqhgccqefbqilntcpu`, web `sgcconstructorasd.com`, PWA `app.sgcconstructorasd.com`) y `dev` (`sgc-dev` = `fzfrnrvndzrjwyvdpkgg`, web `dev.sgcconstructorasd.com`, PWA `app-dev.sgcconstructorasd.com`, datos anonimizados). Refs/URLs/keys de ambos en `.env.local` (`SUPABASE_{URL,ANON_KEY,SERVICE_ROLE_KEY,PROJECT_REF}_{DEV,PROD}`). Publicar en **dev** NO está gateado; **release a prod solo con OK de Xaviel**. Ver `docs/ENTORNOS.md`.
- **Ningún script del hijo tiene prod como destino por defecto**: `build-apk.mjs`/`release-apk.mjs` exigen `--env dev|prod` (vía `scripts/lib/entorno.mjs`); `--env prod` pide confirmación (o `--yes`). `release-apk --env prod` consulta el `app_versiones` de **dev** y **rechaza** si esa versión no salió antes en dev (excepción explícita: `--force-prod --motivo "…"`).
- **Local**: `npm run env:dev` genera `environment.ts` (gitignored) apuntando a dev; `npm start` corre solo si hay proyecto configurado (si no, pantalla "Sin proyecto configurado"). Nunca hardcodear el ref de prod (guard `verify-sin-ref-hardcodeado.mjs` en prebuild).
- **Flavor Android**: `dev` instala junto a prod (`com.constructorasd.csdapp.dev`, "CSD App DEV", icono con banda DEV). La PWA dev es otra app instalable (`app-dev.`, título `[DEV]`, favicon naranja). Cinta **DEV** en el shell + "Acerca de" muestra el entorno.

## Flujo obligatorio (dev → prod)
1. Trabaja en `feature/*` (desde `dev`).
2. `npm run apk -- --env dev` → `npm run apk:publish -- --env dev`; merge `feature/*` → **`dev`** → Vercel construye `app-dev.` Avisa: *"está en app-dev., versión X / APK dev vX"*.
3. **Xaviel prueba en dev.** Con **OK**: PR **`dev → main`** (usa la plantilla; la Action `pr-main` verifica build + regla 18) → merge → `npm run apk -- --env prod` → `npm run apk:publish -- --env prod` (pasa porque ya salió en dev) → Vercel construye `app.`.
4. `main` protegida (PR obligatorio); Xaviel puede saltarla.
- **HANDOFF**: cada sesión cierra con un bloque **"En dev / En prod"** (qué quedó en cada entorno).

## Backend / migrations
El hijo (app) **ya no aplica DDL directo** (`apply-migration.mjs` está retirado). Los SQL del hijo se dejan en `sql-para-sgc/` y **los aplica el PADRE (SGC)** con su ledger y `--env dev|prod` (regla 11/AU1 + regla 18). Data API keys en `.env.local` (anon / service_role) son para acceso a filas desde la app, NO DDL. Toda migración: RLS + schema grants + sequence grants; RPCs backward-compatible ≥2 versiones.

## Versionado / historial (REGLA Y1 — no negociable)
**Cada actualización enviada (web o app móvil) DEBE registrarse en el historial de versiones (`sgc.app_versiones`), automáticamente y SIEMPRE con el mismo formato estructurado.** Formato estándar de una entrada: `version` (semver), `plataforma` (web|movil), `fecha`, `titulo` (corto, opcional) y `cambios[]` donde cada cambio = `{ t: nuevo|mejora|arreglo|seguridad, d: texto }`. La UI del historial pinta chips por tipo para ambas plataformas.
- **App**: `npm run apk -- --env dev|prod` (build) YA **registra la versión al generar el APK** en el `app_versiones` **del entorno** (llama a `release-apk.mjs --env <env> --register-only`), y `npm run apk:publish -- --env <env>` además sube el APK al bucket **del entorno**. Registran SIEMPRE vía `registrar_version(p_plataforma, p_version, p_notas, p_titulo, p_cambios)` con `cambios[]` estructurados (curados en `CAMBIOS_CURADOS`, o de los commits: feat→nuevo, fix→arreglo, perf/refactor→mejora, sec→seguridad). **Ambos FALLAN (exit 1) si no pudieron registrar.** `VERSION` se lee de `src/environments/environment.prod.ts` (fuente única); mantener alineado con `android/app/build.gradle`. Perfil/Ajustes muestra la versión **instalada** + entorno + aviso si hay una publicada más nueva.
- **Web**: el registro corre en cada deploy a `main` (hook de build/CI); el auto-registro al arrancar la app queda como red de seguridad (idempotente).
- Publicar/forzar mínima al usuario es un paso aparte del admin en SGC (flags `publicada`/`minima`); registrar en el historial NO publica.

## Status
M1 (Foundations) complete: scaffold, auth+PIN, offline engine, design system, Home gating, PWA. See HANDOFF.md.
