# Release 2.71.10
- Equipo/dispositivo: Samsung SM-A205U (Android 10, Chrome 158), teléfono de Xaviel por adb.
- Versión de origen: 2.71.5 (APK de prod instalado en ese teléfono; la actualización in-app 2.71.5 → 2.71.10 se prueba DESPUÉS de publicar, abajo). El APK dev se probó aparte (2.71.1-dev → 2.71.10-dev por adb).
- Qué cambia: los archivos NO-PDF del chat (CSV, Excel, Word…) se descargan con su nombre original (`createSignedUrl(..., { download: nombre })`) en vez del UUID del bucket. El PDF sigue inline.
- Resultado: OK (dev) — CSV enviado desde la app dev 2.71.10 (usuario QA de prueba) y «Ver» lo guardó como `prueba-conduces-dv (1).csv` (nombre original; el «(1)» es porque ya existía el archivo con ese nombre). Antes del fix (APK prod 2.71.5) salía `820487dc-…-conduces-atascados-18nov.csv`. Verificado además contra el storage de dev: `content-disposition: attachment; filename=…`.
- Resultado en PROD (post-publicar, mismo teléfono, APK prod 2.71.10 instalado por adb sobre 2.71.5): OK — el CSV real de Raykler (mensaje de prod) se guardó como `conduces-atascados-18nov.csv`, nombre original; sesión y PIN intactos; versión instalada 2.71.10.
- **Actualización in-app 2.71.5 → 2.71.10 NO completó**: la app detectó 2.71.10 y ofreció «Actualizar ahora», el instalador del sistema pidió confirmar, Play Protect pidió analizar (se eligió «Instalar sin analizar») y terminó en «No se instaló la app» (InstallFailed, status code 1, sin motivo; /data con 15 GB libres). El mismo APK instaló sin problema con `adb install -r` (firma OK). Causa NO determinada (posible interacción Play Protect/Samsung A20, 2.71.5 era origen). Hay que repetirla con otro teléfono o desde una versión más reciente.
- NO probado: el botón ↓ por separado; PDF inline; iPhone/PWA.
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «OK --yes»
- [x] APK dev 2.71.10 instalado y abierto
- [x] CSV del chat se guarda con su nombre original
- [ ] Actualización in-app desde la versión anterior en un teléfono real (CL4) — INTENTADA, falló en el instalador (ver arriba)
- [ ] iPhone/PWA
Probado por: Claude Code (sesión asistida) con el teléfono de Xaviel · 2026-11-22
