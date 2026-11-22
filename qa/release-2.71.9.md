# Release 2.71.9
- Equipo/dispositivo: Xiaomi M2101K6G (Android 13), teléfono de Xaviel conectado por adb (se completa abajo con lo que se pruebe antes de publicar).
- Versión de origen: 2.71.7 (APK de prod en ese teléfono).
- Hallazgo: en los reportes de errores de producción (22-nov) la app nativa del Xiaomi registró `sw_update: instalación falló` por `/favicon.ico` (AssetGroup app) justo al actualizar; ese fallo dispara el auto-reparar («Reparando la app…» y PIN de nuevo). La app nativa no necesita service worker (archivos dentro del paquete, push nativo).
- Qué cambia: el service worker queda desactivado en la plataforma nativa (`Capacitor.isNativePlatform()`) y se desregistra el que ya estuviera instalado. La PWA (iPhone/web) no cambia.
- NO probado todavía: iPhone/PWA con esta versión (no cambia su camino); notificaciones push en la app nativa tras el cambio.
- Resultado: pendiente de verificar en el teléfono antes de publicar
- Fecha: 2026-11-22
**OK de Xaviel** 2026-11-22: «y envia a prod los cambios. --yes»
- [ ] Actualizar 2.71.7 → 2.71.9 en el Xiaomi sin «Reparando la app…» (pendiente de ejecutar)
Probado por: pendiente
