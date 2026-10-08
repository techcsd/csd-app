# CSD App — Publicar en Google Play y App Store (CI1–CI14)

Guía paso a paso para 👤 **Xaviel**. La app ya quedó **técnicamente lista** (2.44.0, tanda CI). Lo que falta aquí es **físico**: abrir cuentas, subir binarios, llenar formularios. Claude Code no puede hacer nada de esto (requiere identidad legal, pagos y consolas).

**Decisiones tomadas (CONTEXTO-42 §0):** Google Play **pública** · Apple **Unlisted** (se instala con un enlace que repartimos) · cuentas de **organización** a nombre de Constructora SD · iOS se compila **en la nube** (GitHub Actions, sin Mac).

---

## 0. Orden recomendado (lo que más tarda primero)
1. **D-U-N-S** (gratis, Dun & Bradstreet). Apple ~5 días hábiles; Google dice hasta 28. **Pídelo YA.** Cuidado con sitios que lo cobran.
2. Cuenta **Google Play** (organización, 25 USD una vez).
3. Cuenta **Apple Developer** (organización, 99 USD/año).
4. Firma: subir la llave actual a **Play App Signing** (PEPK).
5. Llaves de API (App Store Connect) + APNs (.p8 a Firebase) + app iOS en Firebase.
6. Secretos de GitHub → disparar TestFlight.
7. Llenar fichas y formularios → enviar a revisión.
8. Apple: pedir **Unlisted** tras aprobar.
9. Pegar las dos URLs en SGC (Admin › Configuración) → la app empieza a actualizar por tienda.

## Tabla "quién hace qué"
| Paso | Quién | Costo | Tiempo |
|---|---|---|---|
| D-U-N-S | 👤 Xaviel | gratis | 5–28 días |
| Cuenta Play (org) | 👤 Xaviel | 25 USD (1 vez) | 1–2 días (verificación) |
| Cuenta Apple (org) | 👤 Xaviel (con autoridad legal) | 99 USD/año | 2–5 días |
| Play App Signing (PEPK) | 👤 Xaviel (con ayuda de esta guía) | — | 10 min |
| AAB de Play | Claude Code (`npm run aab`) / 👤 sube | — | — |
| Proyecto iOS + TestFlight | GitHub Actions (workflow) | minutos macOS 10× | 15–40 min/build |
| Ficha, capturas, formularios | Claude Code redacta → 👤 pega | — | — |
| Enviar a revisión | 👤 Xaviel | — | 1–3 días Play / 1–3 días Apple |

---

## 1. Google Play

### 1.1 Cuenta de organización
- play.google.com/console → crear cuenta **de organización** (no personal).
- Datos: nombre legal (Constructora SD / RNC), dirección, teléfono, sitio web `sgcconstructorasd.com`, D-U-N-S.
- La regla de "12 probadores por 14 días" **NO aplica** a cuentas de organización (solo a personales creadas después del 13-nov-2023).

### 1.2 Play App Signing con la **llave actual** (PEPK) — crítico
Para que los teléfonos que hoy tienen el APK instalado **actualicen desde Play sin desinstalar**, Play debe firmar con **la misma llave** (`android/csd-release.keystore`, cert SHA-256 `3c5316d8…5065`).
1. Al crear la app en Play, elige **"Exportar y subir una clave desde un almacén de claves de Java"**.
2. Google te da el comando PEPK (descarga `pepk.jar`). Ejemplo:
   ```
   java -jar pepk.jar --keystore=android/csd-release.keystore --alias=<alias> \
     --output=output.zip --include-cert \
     --encryptionkey=<la clave pública que te muestra Play>
   ```
   (el alias/contraseñas están en `android/keystore.properties`, gitignored).
3. Sube `output.zip` en Play Console.
> ⚠️ **Respalda `csd-release.keystore` + `keystore.properties` FUERA del PC** (nube privada / USB). Perder la llave = no poder actualizar NUNCA el canal APK (los teléfonos sin Play).

### 1.3 Subir el AAB
```
npm run aab -- --env prod        # genera dist-store/csd-app-2.44.0-play.aab (NO se sube solo)
```
- Play Console → **Prueba interna** primero (añade tu correo como probador) → instala, verifica.
- Luego **Producción** → % de lanzamiento.

### 1.4 Formularios de Play
- **Seguridad de datos**, **Clasificación de contenido (IARC)**, **Público objetivo (18+)**, **Anuncios: No**, **Funciones financieras: ninguna**, **App de noticias: No**.
- Respuestas listas para copiar: **`docs/TIENDAS-DATOS.md`**.
- Declaración de **ubicación en segundo plano**: justificación + **video ≤30 s** (ver guion en `docs/TIENDAS-REVISION.md`).

### 1.5 Ficha
- Icono **512×512**: `dist-store/graficos/icono-play-512.png`.
- Gráfico destacado **1024×500**: `dist-store/graficos/grafico-destacado-A-1024x500.png` (opción A por defecto).
- Capturas (2–8, 9:16): `dist-store/capturas/play/1080x1920/` (genera con `scripts/store/capturas.mjs`).
- Textos: **`docs/TIENDAS-FICHA.md`**.

---

## 2. Apple App Store (Unlisted)

### 2.1 Cuenta de organización
- developer.apple.com/programs/enroll → **organización**. Pide: entidad legal, **D-U-N-S**, persona con autoridad para firmar por la empresa, correo `@constructorasd.com`, sitio web del mismo dominio (`constructorasd.com` ✅).
- **No** hace falta "Iniciar sesión con Apple" (el login es solo con cuentas de la empresa, no hay registro propio).

### 2.2 Llaves
- **App Store Connect API key** (.p8 + Key ID + Issuer ID) → secretos de GitHub (`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`).
- **APNs key (.p8)** → súbela a **Firebase** (proyecto `csd-core` → Cloud Messaging → APNs) para que el push iOS (token FCM) funcione sin tocar el edge `send-push`.
- Crea la **app iOS en Firebase** (`com.constructorasd.csdapp`) → descarga `GoogleService-Info.plist` → secreto `GOOGLE_SERVICE_INFO_PLIST` (base64). Plantilla: `ios/App/App/GoogleService-Info.plist.example`.

### 2.3 Compilar a TestFlight (GitHub Actions)
- Workflow: `.github/workflows/ios-testflight.yml` (disparo **manual**, input `env`).
- Secretos esperados (si falta uno, el job falla diciendo cuál): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_PASSWORD` (+ repo/clave de `match`) o certificados, `GOOGLE_SERVICE_INFO_PLIST`.
- Runner `macos-15` con **Xcode 26** (obligatorio para subir desde 28-abr-2026).
- ⚠️ Los minutos de macOS en repos privados cuestan **10×** → solo disparo manual, no en cada push.

### 2.4 Ficha + formularios
- Icono **1024×1024 sin transparencia**: `dist-store/graficos/icono-appstore-1024.png`.
- Capturas iPhone **6.9" (1320×2868)**: `dist-store/capturas/ios/1320x2868/`.
- **Privacidad de la app** (etiquetas) + **cuestionario de edad**: `docs/TIENDAS-DATOS.md`.
- URL de **privacidad** y de **soporte**: `https://sgcconstructorasd.com/politicas/privacidad` y `/politicas/soporte`.
- **Notas para el revisor** (inglés) + cuenta demo: `docs/TIENDAS-REVISION.md`.

### 2.5 Unlisted
- Envía a revisión **normal**. En *Notas para el revisor* explica que es para empleados.
- Tras **aprobar**, solicita Unlisted en developer.apple.com/contact/request/unlisted-app.
- Te dan un enlace del App Store para repartir; las actualizaciones llegan solas.

---

## 3. Después de publicar — conectar la app
En **SGC → Admin › Configuración** pega:
- `play_store_url` = la ficha de Google Play.
- `app_store_url` = el enlace Unlisted del App Store.

Con eso:
- El **canal apk** (2.44.0+) muestra el aviso único "ya estamos en Google Play" con botón.
- La **PWA iOS** muestra "ya estamos en el App Store".
- La actualización in-app usa el canal oficial.

## 4. CI14 — Verificación de desarrollador de Google (APK fuera de Play, 2027)
- Con **Play App Signing** la app queda registrada sola.
- El **canal APK** (teléfonos sin Play, p. ej. Huawei) debe seguir firmándose con **la misma llave**.
- Global en 2027; ya exigida (sep-2026) en BR/ID/SG/TH. Si algún día se abandona el APK, se apaga ese canal (publicar solo para Play).

## 5. Firma — resumen
- **Una sola llave** (`csd-release.keystore`) para TODO: canal apk y canal play (Play App Signing la recibe por PEPK). Mismo `applicationId` `com.constructorasd.csdapp`.
- Dev instala aparte (`…​.dev`), nunca va a tienda.
- **Respaldo de la keystore fuera del PC = obligatorio.**
