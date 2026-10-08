# CSD App — iOS (CI9): scaffold listo, **bloqueado en la cuenta Apple**

El proyecto iOS se compila en la nube (GitHub Actions, runner macOS) porque no hay Mac.
Todo lo que Claude Code **podía** dejar hecho está hecho; lo que falta es **físico de
Xaviel** (cuenta Apple Developer + llaves + secretos). `ios/` NO se versiona: lo genera
`npx cap add ios` en el runner.

## Lo que YA está (en este repo)
- `@capacitor/ios` instalado (package.json).
- Workflow `.github/workflows/ios-testflight.yml` (manual, input `env`; Xcode 26; verifica secretos).
- `scripts/ios-prepare.mjs` — parchea Info.plist (permisos ES, UIBackgroundModes `[location, remote-notification]`, orientación vertical, `ITSAppUsesNonExemptEncryption=NO`) y copia el privacy manifest + Fastfile.
- `ios-templates/PrivacyInfo.xcprivacy` — datos recogidos + APIs de motivo requerido de los plugins.
- `ios-templates/Fastfile` — lane `beta` (build + TestFlight con API key).
- `ios-templates/GoogleService-Info.plist.example` — plantilla (el real va por secreto).

## Lo que falta (👤 Xaviel) — BLOQUEANTE
1. **Cuenta Apple Developer (organización)** + D-U-N-S (ver `TIENDAS.md`).
2. **App iOS en Firebase** (`com.constructorasd.csdapp`, proyecto `csd-core`) → `GoogleService-Info.plist` → secreto `GOOGLE_SERVICE_INFO_PLIST` (base64).
3. **APNs .p8** subida a Firebase (para que el token FCM funcione en iOS sin tocar `send-push`).
4. **Secretos de GitHub:** `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (App Store Connect API key), `GOOGLE_SERVICE_INFO_PLIST`, y para firma `MATCH_GIT_URL` + `MATCH_PASSWORD` (o certificados manuales).
5. Disparar el workflow **iOS → TestFlight** (manual) → revisar en TestFlight → enviar a revisión → pedir **Unlisted**.

## Compatibilidad verificada (07-oct-2026)
- `@capacitor/ios@8.5.3` → OK con Capacitor 8.4.1.
- `@capacitor-firebase/messaging@8.5.2` → peer `@capacitor/core >=8.0.0` → **OK con Cap 8**. El workflow lo instala (`+ firebase@^12.6.0`) para obtener el token **FCM** en iOS (no hay que cambiar `send-push`). `device_tokens.plataforma='ios'` ya lo contempla `platform-report.service.ts`.
- `@capawesome/capacitor-app-update@8.1.0` (In-App Updates de Play) → OK con Cap 8 (canal Android `play`).

## Equivalentes de los plugins solo-Android (resueltos por canal/plataforma)
| Android | iOS |
|---|---|
| ApkInstaller (auto-update APK) | No existe: canal `appstore` abre la ficha del App Store (`UpdaterService.actualizarAppStore`). Guardado por `canal`/plataforma; nada lo llama en iOS. |
| AlarmScheduler / WeeklyAlarm (alarma dominical full-screen) | **Pendiente**: `@capacitor/local-notifications` semanal (misma hora/regla AL6). iOS no permite alarma a pantalla completa. → TODO al activar iOS. |
| AppSettings (batería) | En iOS no aplica batería; abrir Ajustes de la app (`app-settings:`). |
| CsdMessagingService (FCM) | `@capacitor-firebase/messaging` (token FCM). |

## Rastreo iOS
- `@capacitor-community/background-geolocation` con permiso "Siempre" + la regla de estado de CI5 (ya implementada en `TrackingService`, es cross-plataforma). El indicador azul de iOS es lo esperado.

## Notas de voz en WKWebView
- iOS graba `audio/mp4`. **Verificar** que `transcribe-now` lo acepte cuando se active iOS; si no, convertir en cliente o reportar al padre (PARIDAD).

## Apple 2.5.2 (no cargar código remoto)
- El bundle va dentro de la app; el service worker de Angular **no** debe traer builds nuevos del servidor en nativo. Confirmar en el primer build iOS.

## Costo
- Minutos de macOS en repos privados = **10×**. Por eso el workflow es de **disparo manual**, no por push.
