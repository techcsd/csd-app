# Release 2.66.2

- **Equipo/dispositivo:** teléfono de Xaviel (verificación de causa raíz) + reporte de Misael (segundo teléfono, independiente).
- **Versión de origen:** 2.66.1 / 2.66.0 (las publicadas en prod — ambas afectadas).
- **Qué se probó:** incidente real — Misael reportó que la app se cerraba sola al
  abrirla en 2.66.0; Xaviel lo reprodujo en un segundo teléfono. Diagnóstico por
  `adb logcat` instalando el APK real de prod (2.66.0) en un dispositivo
  conectado: `FATAL EXCEPTION` nativa —
  `IllegalStateException: Default FirebaseApp is not initialized` dentro de
  `PushNotificationsPlugin.register()`, en cuanto la app intenta registrar push
  al abrir (siempre, apenas arranca). Causa raíz: el APK de prod de 2.66.0/2.66.1
  se construyó desde un worktree nuevo sin copiar `android/app/google-services.json`
  (gitignored, vive solo en el checkout principal) — sin Firebase, la llamada nativa
  lanza y Android mata el proceso completo (no es atrapable desde JS). Fix: v2.66.2
  se reconstruye con el archivo correcto + un try/catch defensivo alrededor del
  registro de push (DJ1). No es un bug de código de la ronda DI — es un error de
  empaquetado de esta sesión. `npm run build` + `npm test` verdes.
  **Pendiente de verificación on-device de la versión corregida** (bloqueada por
  el gate de PR a `main` antes de poder construir el APK de prod firmado) — se
  hará inmediatamente tras el merge, antes de publicar.
- **Resultado:** causa raíz confirmada y corregida; verificación final on-device pendiente del build post-merge.
- **Fecha:** 2026-11-05.

OK: Xaviel escribió "so is ready? go ahead", 2026-11-05 — autoriza el hotfix de prod para este incidente activo (app crasheando en producción).
