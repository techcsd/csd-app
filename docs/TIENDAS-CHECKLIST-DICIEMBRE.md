# Tiendas — checklist de diciembre (ronda DX, 23-nov-2026)

Versión de la app auditada: **2.72.0** (en dev). **Sin cuentas todavía** (decisión de Xaviel): nada de Google Play, Apple ni D-U-N-S se tocó.

## Tabla única: qué / quién / bloqueado por / estado
| # | Qué | Quién | Bloqueado por | Estado |
|---|---|---|---|---|
| 1 | **D-U-N-S** (gratis, Dun & Bradstreet) | Xaviel | — (pedirlo YA) | Pendiente, sin pedir. **Camino crítico** |
| 2 | Cuenta Google Play (organización, 25 USD) | Xaviel | D-U-N-S | Pendiente |
| 3 | Cuenta Apple Developer (organización, 99 USD/año) | Xaviel (autoridad legal) | D-U-N-S | Pendiente |
| 4 | **Respaldo** de `constructorasd.keystore` + `android/keystore.properties` **fuera del PC** | Xaviel | — | Pendiente; no verificable desde aquí. El hash del certificado SÍ se reproduce: SHA-256 `3C:53:16:D8:…:DF:50:65` (23-nov, `keytool -list`, sin imprimir secretos) |
| 5 | Play App Signing con la llave actual (PEPK) | Xaviel | cuenta Play | Pendiente; pasos en `TIENDAS.md` §1.2 (ruta de la keystore corregida) |
| 6 | AAB firmado, 64 bits, targetSdk 36, 16 KB | Claude | — | **Listo.** `npm run aab -- --env dev`: 2.72.0, 20,4 MB, 4 ABIs (arm64-v8a, armeabi-v7a, x86, x86_64), 4 `.so` con alineación 16 KB, targetSdk 36. El de **prod** se genera con OK de Xaviel (registra en `app_versiones` de prod) |
| 7 | Flavor `play` sin `REQUEST_INSTALL_PACKAGES` / `USE_FULL_SCREEN_INTENT` / `IGNORE_BATTERY` | Claude | — | **Verificado** en el manifest fusionado del AAB |
| 8 | Permisos con declaración en Play: `ACCESS_BACKGROUND_LOCATION` (+ video ≤30 s), `FOREGROUND_SERVICE_LOCATION`, `SCHEDULE_EXACT_ALARM` (alarma dominical), `RECORD_AUDIO`, `CAMERA` | Xaviel llena formularios | cuenta Play | Técnico listo; formularios pendientes. Guion en `TIENDAS-REVISION.md` |
| 9 | Seguridad de datos / privacidad Apple releídas contra 2.72.0 | Claude | — | **Hecho** (`TIENDAS-DATOS.md`, sección «Revisión contra la 2.72.0»). Xaviel: actualizar `DATOS-Y-TERCEROS.md` del padre y la política pública (ML Kit, escaneos de QR, Odoo) |
| 10 | Ficha, textos, «Novedades» | Claude | — | **Hecho** (`TIENDAS-FICHA.md`: QR, idiomas, modo práctica) |
| 11 | Capturas con **datos del sitio DEMO** (`scripts/store/capturas.mjs`) | Claude | sitio DEMO | Pendiente: no regeneradas esta ronda |
| 12 | Cuentas de revisión `revision.tiendas@…` y `revision.chofer@…` | Xaviel | — | Pendiente. Las contraseñas en `TIENDAS-REVISION.md` siguen «[Xaviel pega aquí]»; **no se inventan**. Guárdalas en `.env.local` como `STORE_REVIEW_SUPERVISOR_PASSWORD` y `STORE_REVIEW_DRIVER_PASSWORD` (hoy **no existen** en `.env.local`) |
| 13 | URL pública de privacidad y soporte (sin sesión) | Claude (PROMPT-154 F10) / Xaviel confirma | SGC | Pendiente: verificar en prod que `https://sgcconstructorasd.com/politicas/privacidad` abre sin login |
| 14 | Clasificación IARC, público 18+, anuncios «No», funciones financieras «ninguna» | Xaviel | cuenta Play | Pendiente; respuestas en `TIENDAS-DATOS.md` |
| 15 | Video de ubicación en segundo plano (≤30 s) | Xaviel graba | cuenta Play | Pendiente; guion listo |
| 16 | iOS: proyecto generado y compilado **sin firma** | GitHub Actions | tu OK para empujar la rama | Workflow con `solo_compilar` listo; **no corrido** (10× minutos macOS) |
| 17 | iOS: `Info.plist` (cámara incl. QR, ubicación siempre/en uso, micrófono, fotos, Face ID) y `PrivacyInfo.xcprivacy` | Claude | — | **Revisado/actualizado** (cámara menciona QR) |
| 18 | iOS: llave App Store Connect (`.p8`, Key ID, Issuer ID) y APNs `.p8` en Firebase `csd-core` | Xaviel | cuenta Apple | Pendiente |
| 19 | iOS: secretos de GitHub (solo nombres): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD` (+ `MATCH_GIT_URL`), `GOOGLE_SERVICE_INFO_PLIST` | Xaviel | cuenta Apple | Pendiente |
| 20 | iOS: Universal Links (Team ID + `apple-app-site-association` + Associated Domain) | Claude cuando haya Team ID | cuenta Apple | Plantilla en `ios-templates/` |
| 21 | Android App Links (`assetlinks.json` + `autoVerify`) | Claude | — | **Listo**; se verifica al desplegar la PWA. Si Play App Signing re-firma con otra llave, **añadir su SHA-256** a `assetlinks.json` |
| 22 | Apple **Unlisted** | Xaviel | app aprobada | Pendiente; texto abajo |
| 23 | Pegar `play_store_url` y `app_store_url` en SGC (Admin › Configuración) | Xaviel | apps publicadas | Pendiente; vacías = la app se comporta como hoy |

## Calendario honesto
Supuestos: D-U-N-S tarda **5–28 días** desde que se pida; Play 1–2 días de verificación de cuenta + 1–3 de revisión; Apple 2–5 días de cuenta + TestFlight + 1–3 de revisión + solicitud de Unlisted.
- **Pides el D-U-N-S esta semana y llega en ≤ 2 semanas (≈ 7-dic):** Play puede quedar **publicada antes del 24-dic**. Apple Unlisted es **ajustado**: probablemente enero.
- **El D-U-N-S tarda las 4 semanas (≈ 21-dic):** **diciembre NO alcanza para ninguna de las dos tiendas.** Lo técnico ya estará listo; el retraso es de cuenta, no de código.
- Lo único que se adelanta sin cuenta: los puntos ya hechos y la corrida `solo_compilar` de iOS.

## Texto para el formulario de Apple Unlisted (inglés, listo para pegar)
> CSD App is an internal field-operations tool for the employees of Constructora SD, a construction company in the Dominican Republic. Accounts are created exclusively by the company's administrators; there is no public sign-up, and the app has no value to anyone outside the company. We therefore request distribution as an Unlisted App so that our staff can install it from a direct link, instead of being discoverable in public App Store search or charts. The app does not collect data from the general public, shows no ads, and has no in-app purchases. Reviewer demo credentials and a description of location use (shared only while a driver is on duty, with a persistent indicator) are provided in the App Review notes.

## Otros datos de la auditoría
- `webview-viejo-guia.md`: WebView mínimo soportado = **Chromium 111**; con uno más viejo la app muestra un aviso con botón «Actualizar» en vez de pantalla en blanco (v1.57.0+). Vigente.
- Service worker desactivado en nativo (2.71.9) y pantalla de rescate `/reparar.html`: pendientes de probar en teléfono (ver `RONDA-DX-AVANCE-APP.md`).
