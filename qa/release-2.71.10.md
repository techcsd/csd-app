# Release 2.71.10
- Equipo/dispositivo: Samsung SM-A205U (Android 10, Chrome 158), teléfono de Xaviel por adb.
- Versión de origen: 2.71.1-dev (APK dev instalado por adb `install -r`; el APK de prod en ese teléfono sigue en 2.71.5).
- Qué cambia: los archivos NO-PDF del chat (CSV, Excel, Word…) se descargan con su nombre original (`createSignedUrl(..., { download: nombre })`) en vez del UUID del bucket. El PDF sigue inline.
- Resultado: OK (dev) — CSV enviado desde la app dev 2.71.10 (usuario QA de prueba) y «Ver» lo guardó como `prueba-conduces-dv (1).csv` (nombre original; el «(1)» es porque ya existía el archivo con ese nombre). Antes del fix (APK prod 2.71.5) salía `820487dc-…-conduces-atascados-18nov.csv`. Verificado además contra el storage de dev: `content-disposition: attachment; filename=…`.
- NO probado: el botón ↓ de descarga por separado (mismo código y nombre que «Ver»); PDF inline con esta versión; actualización in-app 2.71.9 → 2.71.10 (el APK de prod del teléfono está en 2.71.5, no en 2.71.9); iPhone/PWA.
- Fecha: 2026-11-22
**OK de Xaviel para prod:** pendiente.
- [x] APK dev 2.71.10 instalado y abierto
- [x] CSV del chat se guarda con su nombre original
- [ ] Actualización in-app desde la versión anterior en un teléfono real (CL4)
- [ ] iPhone/PWA
Probado por: Claude Code (sesión asistida) con el teléfono de Xaviel · 2026-11-22
