# Release 2.71.9
- Equipo/dispositivo: Xiaomi M2101K6G (Android 13), teléfono de Xaviel conectado por adb (se completa abajo con lo que se pruebe antes de publicar).
- Versión de origen: 2.71.7 (APK de prod en ese teléfono).
- Hallazgo: en los reportes de errores de producción (22-nov) la app nativa del Xiaomi registró `sw_update: instalación falló` por `/favicon.ico` (AssetGroup app) justo al actualizar; ese fallo dispara el auto-reparar («Reparando la app…» y PIN de nuevo). La app nativa no necesita service worker (archivos dentro del paquete, push nativo).
- Qué cambia: el service worker queda desactivado en la plataforma nativa (`Capacitor.isNativePlatform()`) y se desregistra el que ya estuviera instalado. La PWA (iPhone/web) no cambia.
- NO probado todavía: iPhone/PWA con esta versión (no cambia su camino); notificaciones push en la app nativa tras el cambio.
- Resultado: OK — actualización in-app 2.71.7 → 2.71.9 probada en el Xiaomi con la app de prod (PIN y sesión reales): se instaló por el flujo normal (banner → Actualizar ahora → instalador → Play Protect), la versión instalada quedó 2.71.9 (03:09), al abrir pide el PIN una sola vez y entra al inicio sin «Reparando la app…» ni segundo PIN, y no llegó ningún error nuevo a los reportes de producción (sin sw_update desde las 03:00).
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «y envia a prod los cambios. --yes»
- [x] Actualizar 2.71.7 → 2.71.9 en el Xiaomi sin «Reparando la app…» (hecho; el publicar de release-apk también corrió solo en dev y prod)
- [x] APK dev 2.71.9 instalado y abierto antes de publicar en prod
- [ ] iPhone/PWA con esta versión (su camino no cambia; no se probó)
Probado por: Claude Code (sesión asistida) con el teléfono de Xaviel · 2026-11-22
