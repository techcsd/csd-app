# Reglas de la app para el Guardián IA (EA3)

El Guardián de SGC (`guardian.md`, punto 7) lee este archivo **de la rama base** y rechaza el PR si el diff incumple alguna regla. Son reglas propias de csd-app; las genéricas viven en SGC.

1. **Escrituras por el outbox.** Nada se escribe directo a Supabase desde una captura: se guarda en Dexie, se encola en el outbox con UUID de cliente (idempotente) y el handler se registra con `sync.register` bajo un `tipo_op` único (el registro es last-wins). Los servicios que registran handlers se arrancan en `app.config`.
2. **Borradores y autosave (bug de requisiciones duplicadas, 2.73.4).** Tras un envío exitoso el borrador se descarta (`AutosaveService.discard`, `BorradorService`) en el mismo flujo que cambia el estado. Un `effect` no puede volver a encolar con `queue` después del éxito (reabre el borrador). Un cambio en pantallas con autosave necesita una prueba «crear, enviar, volver a entrar: formulario vacío».
3. **Offline.** Una pantalla de captura nueva debe funcionar sin red. No se rompe el service worker ni el precache (`scripts/ngsw-precache-inicial.mjs`).
4. **Y1 / versiones (zona roja).** No tocar `VERSION` (`environment.prod.ts`), `android/app/build.gradle`, `app_versiones`, `src/environments/` ni `scripts/release-apk.mjs`. El agente no publica APK ni registra versión.
5. **UI.** Textos en español con `| t` y `TranslatePipe` en `imports[]` (solo `ng build` detecta su falta). Colores solo con tokens CSS (`_tokens.scss`). Controles de al menos 56 px.
6. **RPC y RLS.** Las RPC deben seguir siendo compatibles con las 2 últimas versiones de la app. Toda tabla o secuencia nueva lleva RLS y grants. El SQL de la app no se aplica aquí: se deja en `sql-para-sgc/` y lo aplica SGC.
7. **Datos y terceros.** Un dato nuevo o un tercero nuevo exige actualizar `docs/TIENDAS-DATOS.md`.
8. **Roles y módulos.** Los gates salen de la BD (`hasModulo`, `puedeVerSubmodulo`, `puedeOperarSubmodulo`); no se inventan listas de roles.
