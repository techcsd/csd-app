# Source maps y stacks legibles (EA, 25-nov-2026)

**Problema:** los stacks de `app_error_reports` llegan minificados (`chunk-XXXX.js:1:NNNNN`) y no se podían mapear al código.

**Solución:**
1. `angular.json` (`production` y `dev`): `sourceMap` **oculto** (el JS no trae `sourceMappingURL`; mismo comportamiento).
2. `scripts/build-env.mjs` llama a `scripts/sourcemaps.mjs retirar` tras `ng build`: saca TODOS los `.map` de `dist/` (si quedara alguno, el build **falla**: sería fuga de código fuente) a `dist-maps/<versión>/<canal>/` y los sube al bucket **privado** `app-sourcemaps` (`<versión>/<canal>/<archivo>.map`). Sin credenciales (p. ej. Vercel/CI) solo los retira; subir nunca rompe el build.
3. Bucket creado con `scripts/data-fixes/2026-11-25-ea-bucket-sourcemaps.mjs` (dev y prod; solo `service_role`, sin políticas para usuarios).
4. `simbolizar`: `node scripts/sourcemaps.mjs simbolizar --env prod --reporte <uuid>` (toma versión y canal del reporte; `context.canal` desde 2.73.0) o `--version X --canal Y [--archivo stack.txt]`. Prueba real: un frame de `chunk-6OAEKCA3.js:1:322` → `src/app/core/services/tec-proveedores.service.ts:33:60`.

**Qué sube cada canal:** `npm run apk -- --env prod` (canal `apk`) y `npm run aab` (`play`) suben solos. El **PWA** lo construye Vercel (sin credenciales): tras mergear a `main`, correr localmente en el mismo commit `node scripts/build-env.mjs --env prod --canal pwa` (sube) y luego `node scripts/sourcemaps.mjs alinear --env prod --yes`: Vercel compila en Linux y los nombres con hash NO coinciden con los locales aunque el contenido sea igual, asi que `alinear` empareja por contenido y sube los maps con los nombres del despliegue (probado en 2.73.1: 446/446). Dos builds locales del mismo commit dan los mismos hashes; el de Vercel no. No se puso la service role de prod en Vercel a propósito (los previews de PR construyen código no revisado).

**Límites:** solo código de la app (no `vendor`); los reportes anteriores a 2.73.1 no tienen mapas.
