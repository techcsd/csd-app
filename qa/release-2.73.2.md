# Release 2.73.2
- Equipo/dispositivo: Samsung SM-A205U (Android 10, WebView 157), conectado por adb; Chrome de escritorio para el PWA.
- Versión de origen: 2.73.1 (prod) — la actualización in-app 2.73.1→2.73.2 NO se probó (instalación por adb).
- Qué cambia: el flavor dev ya trae push (app Firebase com.constructorasd.csdapp.dev en csd-core); .gitignore del google-services.json de dev; comando `sourcemaps alinear` para los mapas del PWA. Sin cambios de pantallas.
- Qué verificó Claude: 111 tests, build con guards y test:canal; APK dev con el google_app_id de la app .dev (y no el de prod); APK dev 2.73.1-dev instalado en el teléfono y arranca hasta la pantalla de login/PIN; PWA dev carga (pantalla de PIN); APK prod 2.73.1 instalado desde el bucket y arranca hasta el PIN.
- Qué NO se probó: flujos con sesión iniciada en el APK (el teclado Samsung desordena el texto de `adb input` y el login falló con «Correo o contraseña incorrectos»; las credenciales sí son válidas contra Supabase) ni en el PWA (sesión de Xaviel tras PIN). Tampoco se envió una notificación push de prueba.
- Resultado: OK de build y arranque; NO verificado con sesión.
- Fecha: 2026-11-25

**OK de Xaviel** (2026-11-25): «aprueba el pr y haz todo… sube el apk, haz release, bump y todo» (release 2.73.2 a prod).
