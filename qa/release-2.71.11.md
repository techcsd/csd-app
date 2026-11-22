# Release 2.71.11
- Equipo/dispositivo: Samsung SM-A205U (Android 10), teléfono de Xaviel por adb. Pruebas en la app DEV (usuario QA de prueba).
- Versión de origen: 2.71.10 (APK dev; el de prod en ese teléfono también está en 2.71.10). Se probó actualizar 2.71.10-dev → 2.71.11-dev por la vía in-app.
- Qué cambia: la pantalla de actualizar (canal APK) avisa qué tocar cuando Google Play Protect pregunta («Analizar app» y luego «Instalar»). Solo texto/estilo + en/ht. Causa: en el A20 «Instalar sin analizar» terminó en rechazo de Play Protect (install result -22).
- Resultado: OK (dev) — actualización in-app 2.71.10-dev → 2.71.11-dev completa en el A20 con «Analizar app» → «Esta app parece segura» → Instalar; también 2.71.9-dev → 2.71.10-dev. Build verde (guards i18n incluidos).
- Resultado en PROD (post-publicar, mismo A20): OK — actualización in-app 2.71.10 → 2.71.11 con el APK de prod: Play Protect pidió analizar, se eligió «Analizar app» → «Esta app parece segura» → Instalar → result=ALLOW; versión instalada 2.71.11; abre con PIN y sesión intactos, sin banner de actualización.
- NO probado: el aviso en pantalla (solo se muestra cuando hay una versión más nueva disponible; ya no la hay); que el aviso evite el rechazo de Play Protect (se eligió «Analizar app» a propósito, no se repitió «Instalar sin analizar» en prod); iPhone/PWA (no cambia su camino).
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «OK --yes, publica 2.71.11 en prod»
- [x] APK dev 2.71.11 instalado por vía in-app y abierto
- [x] Actualización in-app desde la versión anterior en un teléfono real (dev)
- [x] Actualización in-app en prod 2.71.10 → 2.71.11 (hecha después de publicar, A20)
- [ ] iPhone/PWA
Probado por: Claude Code (sesión asistida) con el teléfono de Xaviel · 2026-11-22
