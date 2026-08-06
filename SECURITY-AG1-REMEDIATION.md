# AG1 — Secret leak remediation (GitHub secret scanning)

**Fecha:** 2026-08-06 · **Repo:** `techcsd/csd-app` · **Alerta:** Google API Key en `android/app/google-services.json#L18` (commit `0a7dcdce`).

---

## 1. Auditoría completa del repo (hecha por Claude Code)

Escaneo con **gitleaks v8.28.0** sobre el **historial completo** (198 commits) y el **working tree** (incl. archivos ignorados y artefactos de build), más búsqueda dirigida de patrones peligrosos en todos los blobs de la historia.

### Único secreto real filtrado en el repo/historial
| Secreto | Ubicación | Commits | Severidad | Acción |
|---|---|---|---|---|
| **Google/Android API key** `AIzaSy…HeHgs` | `android/app/google-services.json` L18 | `0a7dcdc`, `9584a1f`, `5b683a5`, `e708c90`, `799c919` (5 commits, desde 0a7dcdc hasta HEAD) | Media — es key de **identificación de app** (Firebase/Android); no da acceso a datos por sí sola, pero se restringe y se saca del repo igual | Sacada de tracking + purga de historial + rotación/restricción (abajo) |

### Detectado por gitleaks pero **NO es fuga** (público por diseño)
| Hallazgo | Ubicación | Por qué es seguro |
|---|---|---|
| Supabase **anon** key (JWT, `role=anon`) | `src/environments/environment.ts` L10-11, `environment.prod.ts` L7-8 (y bundles en `dist/`, `android/app/build/`) | La anon key **está diseñada para vivir en el cliente**; está protegida por RLS. Es el patrón estándar de Supabase. **No requiere rotación.** Decodifiqué el JWT: rol = `anon`, no `service_role`. |

### Secretos peligrosos — verificado que **NUNCA** entraron al repo
Todos correctamente fuera del control de versiones (gitignored o leídos de archivos ignorados):
- **`SUPABASE_SERVICE_ROLE_KEY`** y **`SUPABASE_SECRET_KEY`** (`sb_secret_…`) → solo en `.env.local` (gitignored). Búsqueda del fragmento b64 `c2VydmljZV9yb2xl` en toda la historia: **0 hits**. Nunca se comiteó un JWT service_role.
- **Keystore de firma Android** (`*.keystore`/`*.jks`) y **contraseñas** (`android/keystore.properties`) → gitignored; `build.gradle` las lee del archivo ignorado, no hay password hardcodeada.
- **FCM/server keys** → no existen valores en el repo (las 348 coincidencias de "fcm" eran nombres de plugin/código, no secretos).
- `VERCEL_OIDC_TOKEN` → solo en `.env.local`.

> **Conclusión:** la superficie de fuga se limita a **una** key de identificación de app. El `.gitignore` ya cubría bien lo crítico (service_role, keystore, .env). El único descuido fue `google-services.json`.

---

## 2. Ya aplicado por Claude Code (en el working tree, SIN commitear todavía)

1. `android/app/google-services.json` → agregado a `.gitignore`.
2. `git rm --cached android/app/google-services.json` → **destrackeado** (la copia local sigue ahí; el build local sigue funcionando).
3. Creado `android/app/google-services.json.example` (plantilla redacted).
4. `README.md` → sección **"Secrets & local setup"** explicando cómo colocar el archivo real en local/CI.

Además: `.gitleaks.toml` con allowlist de la anon key (pública por diseño) → `gitleaks detect` sale limpio. **Commiteado** con tu OK.

---

## 3. ✅ HECHO — Purga de historial + force push

Con tu OK ("Do it now") se purgó `google-services.json` de **toda** la historia con **BFG 1.15.0** (corrido con el JBR de Android Studio — esta máquina no tiene Python/filter-repo) y se hizo **force push** a `origin/main` (`--force-with-lease`, tras backup en bundle).

Verificado:
- `git log --all -- android/app/google-services.json` → **vacío**.
- La key `AIzaSy…` → **0 ocurrencias** en toda la historia.
- `gitleaks detect -c .gitleaks.toml` → **no leaks found**.
- Las 4 ramas de feature del remoto **no** contenían el archivo (nacieron antes del commit `0a7dcdc`) → no hubo que reescribirlas.
- Backup del estado previo: `csd-app-backup-pre-purge.bundle` (guardado en el tmp del job).

⚠️ **La key sigue comprometida** aunque se purgó (GitHub pudo cachearla/indexarla, y puede servir el commit viejo por SHA directo hasta su GC). **Rotarla (paso 4) es lo único que la neutraliza de verdad.**

---

## 4. ✅ Checklist manual para Xaviel — Google Cloud Console (rotación/restricción)

> La key expuesta empieza por `AIzaSyBwfq…` y termina en `…HeHgs` (valor completo en tu `.env`/consola, **no** se repite aquí para no re-filtrarla), proyecto Firebase **`csd-core`** (project number `165522751632`), app Android `com.constructorasd.csdapp`. **Yo no tengo acceso a la consola** — estos pasos los haces tú.

**A. Restringir la key expuesta (mínimo indispensable, hazlo YA aunque no rotes):**
- [ ] Google Cloud Console → proyecto **csd-core** → **APIs & Services → Credentials**.
- [ ] Abrir la API key `AIzaSy…HeHgs`.
- [ ] **Application restrictions** → *Android apps* → agregar:
  - Package name: `com.constructorasd.csdapp`
  - SHA-1 del certificado de **release** (sácalo con: `keytool -list -v -keystore <tu.keystore> -alias <alias>` — usa el keystore de `android/keystore.properties`). Agrega también el SHA-1 de **debug** si compilas debug.
- [ ] **API restrictions** → *Restrict key* → dejar solo las APIs que la app usa (Firebase Cloud Messaging / Firebase Installations; **Maps SDK** solo si lo usas). Quitar el resto.
- [ ] Guardar.

**B. (Recomendado) Rotar a una key nueva y revocar la vieja:**
- [ ] En Credentials → **+ Create credentials → API key**. Restringirla igual que en (A) (package + SHA-1 + APIs).
- [ ] Firebase console → Project settings → descargar el `google-services.json` nuevo (ya traerá la key nueva) **o** editar el `current_key` en el archivo local.
- [ ] Reemplazar `android/app/google-services.json` local con el nuevo.
- [ ] Rebuild: `npm run apk` → instalar el APK → **verificar que las push notifications (FCM) siguen llegando** y (si aplica) que los mapas cargan.
- [ ] Cuando confirmes que la nueva funciona → **borrar/deshabilitar** la key vieja `AIzaSy…HeHgs` en Credentials.

**C. GitHub (cerrar la alerta y prevención):**
- [ ] Tras la purga de historial (paso 3): repo → **Security → Secret scanning alerts** → marcar la alerta como **Revoked** (si rotaste) o **Resolved**.
- [ ] Repo → **Settings → Code security** → activar **Secret scanning** + **Push protection** (bloquea futuros pushes con secretos). Gratis en repos privados con GitHub Advanced Security / en públicos siempre.

---

## 5. Verificación final (marcar al cerrar)
- [ ] `git log --all -- android/app/google-services.json` → vacío (post-purga).
- [ ] `gitleaks detect` → sin hallazgos nuevos (solo queda la anon key = público por diseño; opcional: allowlist en `.gitleaks.toml`).
- [ ] Build verde con la key nueva (`npm run apk`), FCM funcionando.
- [ ] Alerta de GitHub cerrada + push protection activado.
