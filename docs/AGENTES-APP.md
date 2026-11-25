# Agentes (Ingeniero + Guardianes) en csd-app — EA3 · F4

Estado: **código listo, INERTE**. Nada corre hasta que Xaviel cargue los secrets/Environments de abajo.
El cerebro (cola, despacho, runner, prompts, guardianes, pantalla «Cambios del Ingeniero») vive en **SGC** (PROMPT-156). Aquí solo se conecta este repo.
Contrato y flujo completos: SGC `docs/AGENTES-INGENIERO.md` y `docs/AGENTES-INGENIERO-RUNNER.md`.

## Qué hay en este repo

| Archivo | Para qué |
|---|---|
| `.github/workflows/agente-ingeniero.yml` | Llamador del runner reutilizable de `techcsd/SGC@main`. Disparo: `repository_dispatch` (`agente-ingeniero`, solo si `client_payload.repo == techcsd/csd-app`) o manual. Build = `node scripts/build-env.mjs --env prod` (guards regla 18); tests = `npm test -- --watch=false`. |
| `.github/workflows/agente-guardian.yml` | Jobs `ci-agente`, `g1-determinista`, `g2-guardian` para PR con etiqueta `agente` o rama `agente/**`, `agente-prod/**`. Los scripts/prompts salen **siempre de `techcsd/SGC@main`** (checkout aparte, `.guardianes-sgc/`); el PR entra solo como datos (`pull_request_target`). Para PR que no son del agente se saltan (verde). |
| `.github/agentes/zona-roja-app.json` | Zona roja propia de la app. El workflow la **fusiona** con la de SGC (que ya cubre `android/`, `ios/`, `capacitor.config`, apk/aab/ipa, guards, auth, secrets, dinero, inventario/conduces, notificaciones) leyéndola de la rama **base**, no del PR. |
| `.github/branch-protection-dev.json` | Propuesta (NO aplicada) de protección de `dev`. |

## Zona roja de la app (siempre se detiene en dev y pide el OK de Xaviel)
Nativo/tiendas (`android/`, `ios-templates/`, keystore, `*.jks`, `google-services`, `build.gradle`, `capacitor.config`, `release-apk`/`build-apk`/`aab`/`store/`, `docs/tiendas*`, `ios-testflight`) · versión (`src/environments/`, `app_versiones`, `registrar_version`) · motor offline (`core/sync/`, `core/db/`, cambios de versión Dexie) · service worker (`ngsw-config`) · guardia de los agentes (`.github/agentes/`, `.github/workflows/`, `branch-protection`).
**Zona protegida (rechazo automático, definida en SGC):** `.github/workflows/agente-*.yml`, `scripts/guardianes/**`, `.claude/**`, `CLAUDE.md`, `sql/_reversa/**`, `.github/branch-protection-*.json`.

## ⚠️ Desviación consciente: csd-app NO tiene `agente-promocion.yml` (no promueve a prod sola)
El prompt pedía que los cambios de **web/PWA** de csd-app sí llegaran solos a prod. No lo implementé, por tres razones concretas:
1. El `agente-promocion.yml` de SGC **no es reutilizable** (no tiene `workflow_call`; está atado a las URLs, el proyecto Vercel y el humo de SGC) y su propio documento dice que csd-app no lo lleva (SGC `AGENTES-INGENIERO-RUNNER.md` §5 d).
2. **Regla Y1:** cada actualización enviada debe quedar en `sgc.app_versiones` con su versión; un merge a `main` despliega la PWA por Vercel **sin** bump de versión. Subir la versión toca `src/environments/` + `android/app/build.gradle` = zona roja (siempre pide OK). O sea: en la práctica casi todo cambio de la app acabaría en zona roja de todos modos.
3. No se puede probar sin secrets, y un workflow de auto-merge a `main` sin probar es justo el tipo de cosa que no debe nacer inerte-pero-sin-verificar.
**Resultado:** el Ingeniero abre PR a `dev`, pasa los guardianes y se mergea a `dev` (carril de agentes), y de ahí a `main` sigue el flujo normal (regla 18: tú pruebas en dev y das el OK). Si quieres auto-prod también para la PWA, el siguiente paso sería un `workflow_call` en SGC parametrizado por repo + una forma de registrar versión sin tocar zona roja; decídelo tú.

## Pasos físicos de Xaviel (solo nombres; nunca pegar valores en chat)
1. Settings → Environments de **este repo**: crear `agentes-dev` (sin revisores) y, si luego hubiera promoción, `agentes-prod`.
2. Secrets de `agentes-dev`: `ANTHROPIC_API_KEY`, `SUPABASE_URL_DEV`, `SUPABASE_SERVICE_ROLE_KEY_DEV` (la de **dev**, nunca prod), `AGENTE_INGENIERO_GITHUB_TOKEN` (PAT fine-grained de la cuenta bot, con acceso a **SGC** para leer guardianes y a **csd-app** para escribir; sin permiso Workflows).
3. Settings → Actions → General: permitir que este repo use los workflows reutilizables de `techcsd/SGC` (y que SGC sea visible para el PAT).
4. Aplicar la protección de `dev` (propuesta): `gh api -X PUT repos/techcsd/csd-app/branches/dev/protection --input .github/branch-protection-dev.json`. Para `main`: **añadir** `ci-agente`, `g1-determinista`, `g2-guardian` a `required_status_checks.contexts` del `branch-protection-main.json` actual (hoy solo `build-prod`) antes de aplicarlo — así un PR del agente no llega a `main` sin guardianes. Con `required_approving_review_count: 0` el carril automático es posible; subirlo a 1 lo apaga (el bot no puede aprobarse a sí mismo).
5. Crear `.github/CODEOWNERS` con la zona protegida a nombre de tu usuario de GitHub (no lo escribí: no sé tu login y uno inválido se ignora en silencio): `/.github/workflows/agente-*.yml`, `/.github/agentes/`, `/.github/branch-protection-*.json`, `/CLAUDE.md`, `/.claude/`.
6. Promover estos workflows a `main` (los reutilizables de SGC se leen de `techcsd/SGC@main`; hasta que SGC los tenga en `main`, el llamador no encuentra el workflow).

## Fuente de crashes
`app_error_reports` (`ErrorReportService.report`) ya alimenta la cola de SGC. Trae: `message`, `stack` (saneado, ≤ 8 KB), `app_version`, `platform`, `device_model/brand`, `os_version` y `context` con `entorno`, **`canal`** (nuevo, aditivo: `play|apk|appstore|pwa`, para que el Ingeniero sepa si el fallo es de PWA o de nativo), `route` (pantalla) y memoria. **Stacks legibles (resuelto 25-nov, ver `docs/SOURCEMAPS.md`):** el build emite source maps ocultos que NUNCA se despliegan y van a un bucket privado; `node scripts/sourcemaps.mjs simbolizar --env prod --reporte <id>` devuelve archivo:línea del código fuente. **Pendiente en SGC:** que la cola del Ingeniero llame a ese simbolizador (hoy lo usan Xaviel/Claude Code a mano).

## Evidencia (simulación local de G1, sin red)
G1 real de SGC (`scripts/guardianes/g1.mjs` de `origin/dev`) con la zona roja fusionada, sobre diffs sembrados contra `origin/dev` (24-nov-2026):

| Diff sembrado | Veredicto G1 | Zona roja |
|---|---|---|
| Comentario en `core/util/fecha.ts` | aprobado | no |
| Línea en `ios-templates/Fastfile` | aprobado | **sí** (`nativo_app`) |
| Línea en `core/sync/sync.service.ts` | aprobado | **sí** (`offline_sync`) |
| Archivo `.github/workflows/agente-x.yml` | **rechazado** (`zona_protegida`) | sí |
| `SUPABASE_SERVICE_ROLE_KEY` en `src/app/` | **rechazado** (`service_role_en_cliente`) | no |
| El propio diff de F4 (workflows + zona roja) | **rechazado** (`zona_protegida`, `diff_grande`) | sí |

**NO verificado:** ninguna corrida real en GitHub Actions (sin secrets ni runner); el Guardián IA (G2) y el runner del Ingeniero no se ejecutaron; `ci-agente` no se corrió en CI (su comando equivale a `pr-main` + tests, ambos verdes en local). El prompt del Guardián (`guardian.md`) es el de SGC y no conoce las reglas propias de la app (offline-first/outbox, flujo de versiones); mejorarlo requiere un cambio en SGC (`--dato REGLAS_APP=…`).
