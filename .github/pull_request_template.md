<!-- BU1 — PR hacia `main`. La regla 18 exige que todo haya vivido en dev primero. -->

## Qué cambia


## Checklist (regla 18 — dev → prod)

- [ ] Probado en **`app-dev.sgcconstructorasd.com`** (PWA dev)
- [ ] **APK dev** instalado y probado en un teléfono real (`com.constructorasd.csdapp.dev`)
- [ ] Publicado en **dev**: `npm run apk:publish -- --env dev` (queda en el `app_versiones` de dev)
- [ ] **Bump de versión en los 3 sitios** alineados: `environment.dev.ts` + `environment.prod.ts` + `android/app/build.gradle` (+ `CAMBIOS_CURADOS`/`TITULO` en `release-apk.mjs`)
- [ ] **Rollback** claro (cómo revertir si algo sale mal)
- [ ] `--force-prod` (si aplica) — motivo: ________________

## Notas de despliegue


> Al mergear: `npm run apk -- --env prod` → `npm run apk:publish -- --env prod`
> (pasa la regla 18 porque ya salió en dev) → publicar/mínima en SGC con OK.
