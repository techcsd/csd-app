# Entornos — CSD App (dev / prod) — BU1

La app móvil hereda la **regla 18** del padre (SGC): **nada llega a producción sin
haber vivido y probado en dev primero — y los scripts lo hacen cumplir.** Publicar
en **dev** no está gateado; **release a prod solo con OK de Xaviel**.

La app usa el **mismo proyecto Supabase que la web SGC** en cada entorno: dev de la
app = `sgc-dev`; prod de la app = el proyecto de producción de SGC.

## Los dos entornos

| Capa | **prod** | **dev** |
|---|---|---|
| Supabase | `jeeqhgccqefbqilntcpu` | `fzfrnrvndzrjwyvdpkgg` (sgc-dev) |
| PWA | `app.sgcconstructorasd.com` | `app-dev.sgcconstructorasd.com` |
| APK | `com.constructorasd.csdapp` — "CSD App" | `com.constructorasd.csdapp.dev` — "CSD App DEV" |
| Datos | reales | anonimizados (nombres reales; email/cédula/teléfono no) |
| Push | real (FCM) | **apagado** hasta crear la app Firebase `.dev` |
| Señas visuales | — | cinta **DEV** (esquina), título `[DEV]`, favicon/icono naranja |

Refs/URLs/keys de ambos en `.env.local` (gitignored):
`SUPABASE_{URL,ANON_KEY,SERVICE_ROLE_KEY,PROJECT_REF}_{DEV,PROD}` + `QA_DEV_PASSWORD`.

## ¿En cuál entorno estoy?

1. **Cinta DEV** naranja arriba a la derecha (sobre login/PIN y todo el shell) → dev.
   En prod no hay cinta.
2. **Perfil ⚙ → "Acerca de" → Entorno**: muestra `dev · <ref>` o `prod · <ref>`.
3. PWA: el título de la pestaña dice `[DEV] CSD App`; el icono/nombre instalado es
   "CSD App DEV". APK: el nombre en el launcher es "CSD App DEV" con banda naranja.

## Correr local (`ng serve`)

- `npm run env:dev` → genera `src/environments/environment.ts` (gitignored) apuntando
  a **dev**; luego `npm start`.
- `npm run env:prod` → apunta el serve local a prod (raro; solo para depurar prod).
- Sin generar nada, `npm start` arranca en la pantalla **"Sin proyecto configurado"**
  (nunca habla con prod por defecto — regla 18).
- `environment.dev.ts` / `environment.prod.ts` (committed, anon keys públicas) son la
  fuente de los builds; `build-env.mjs` copia el del entorno a `environment.ts`.

## Publicar (con `--env`, regla 18)

**Ningún script tiene prod como destino por defecto. Sin `--env` no corren.**

| Acción | dev | prod (con OK) |
|---|---|---|
| Build local PWA | `npm run build:dev` | `npm run build:prod` |
| Build APK | `npm run apk -- --env dev` | `npm run apk -- --env prod` (confirma o `--yes`) |
| Subir APK + registrar | `npm run apk:publish -- --env dev` | `npm run apk:publish -- --env prod --yes` |
| Excepción directa a prod | — | añade `--force-prod --motivo "…"` |

`release-apk --env prod` **consulta el `app_versiones` de dev**: si esa `version` no
salió antes en dev → **rechaza** (*"X no ha salido en dev. `npm run apk:publish -- --env dev`
primero"*). `--force-prod --motivo "…"` lo salta y deja rastro en la fila.

`version.json` del bucket lleva `entorno`; **una app dev jamás ofrece instalar un APK
prod y viceversa** (el `VersionService` solo acepta el de su propio entorno).

## Instalar las DOS apps en el teléfono (dev junto a prod)

**PWA dev (iPhone/Android):** abre `https://app-dev.sgcconstructorasd.com` en el
navegador → "Añadir a pantalla de inicio". Como el dominio es distinto al de prod, iOS
la trata como **otra PWA** (no pisa la de prod). Se ve "CSD App DEV".

**APK dev (Android):** instala `app-dev-release.apk`. Su `applicationId` es
`…​.dev`, así que **convive** con la app de prod (dos iconos: "CSD App" y "CSD App DEV").
Misma keystore → sin conflicto de firma.

## Login en dev

Usuarios = los reales **anonimizados** del seed de `sgc-dev`. Contraseña única =
`QA_DEV_PASSWORD`. PIN de choferes = `000000`. Detalle en `QA-USERS.local` y en el
`docs/ENTORNOS.md` del padre (SGC). Nada real se toca en dev.

## Rollback

- **APK dev:** desinstalar el flavor `.dev` **no afecta** la app de prod.
- **PWA dev:** quitar el dominio `app-dev.` en Vercel; borrar la PWA del teléfono.
- **Local:** `environment.ts` se regenera con `npm run env:dev|prod`.
- **Scripts/código:** `git revert`.
- **Todo dev:** el proyecto `sgc-dev` se pausa/borra sin tocar prod.

## Pasos físicos (solo Xaviel)

- **DNS + Vercel:** `CNAME app-dev → cname.vercel-dns.com`; en el proyecto Vercel de la
  app, marcar `dev` como *Preview branch* y asignarle el dominio `app-dev.sgcconstructorasd.com`.
  (Vercel construye con `build-env.mjs`: preview → dev, production → prod.)
- **Firebase (push dev, opcional):** crear una **app Android** en el mismo proyecto
  Firebase con id `com.constructorasd.csdapp.dev`, descargar su `google-services.json`
  y ponerlo en `android/app/src/dev/google-services.json`. Hasta entonces el APK dev
  **compila sin push** (y "Acerca de" lo dice). El plugin lo toma solo al aparecer.
- **Google Cloud (Maps):** restringir el referrer de la key a `app-dev.` o cuota aparte.
- **Instalar** la PWA dev y el APK `.dev` en su teléfono para el device-QA.
- **Repartir el APK dev** a Raykler/Felix: DEFAULT **no** (solo Xaviel prueba dev).
