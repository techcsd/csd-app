# Release 2.71.7
- Equipo/dispositivo: Xiaomi M2101K6G (Android 13), teléfono de Xaviel conectado por adb; APK dev 2.71.7 (`com.constructorasd.csdapp.dev`).
- Versión de origen: 2.71.6 (el APK dev 2.71.7 se instaló encima con `adb install -r`, mismo certificado, sin desinstalar). La actualización in-app desde el APK prod no se probó antes de publicar.
- Qué se probó: tras instalar y abrir, el login muestra el logo «SD» (antes aparecía como imagen rota). Causa: `angular.json` solo publica `public/` y los logos estaban en `src/assets/`; se movieron a `public/assets/imgs/logos/`. Los 3 archivos aparecen en `dist/.../assets/imgs/logos/`. Build verde.
- Resultado: OK — logo visible en el teléfono (captura del login, 22-nov 00:20). No se probó el logo en el carnet ni en iPhone.
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «publica el APK y registra la versión, do all the stuff» (publicar el APK 2.71.7 como versión vigente en prod).
