# Release 2.71.1

- Equipo/dispositivo: Samsung SM-A205U (Android 10), APK dev conectado por adb; backend dev.
- Versión de origen: 2.71.0 (APK dev 2.71.0 instalado en el teléfono). La 2.71.1 se instaló encima con `adb install -r` (misma llave de firma; versionName pasó de 2.71.0-dev a 2.71.1-dev). NO se ejercitó el botón del instalador in-app (ApkInstaller): este release no toca el actualizador.
- Qué se probó: con permiso concedido y ubicación encendida pero sin señal GPS (bajo techo), el wizard de Crear conduce llegó a «Generar conduce» y creó el conduce («Conduce generado»); en `gps_eventos` quedó `operando_sin_gps` con detalle `crear_conduce:sin_senal`. Con la ubicación apagada, el asistente de GPS abre y «Ahora no» → motivo registra `asistente_rechazado:no_se_como:apagado` (2.71.0).
- Resultado: OK con límites. No se probó el asistente con el permiso negado, ni el caso con señal real (el teléfono de pruebas no obtiene fix bajo techo).
- Fecha: 2026-11-18

**OK de Xaviel** 2026-11-18: autorizó en el chat enviar a prod con bump y release ("pruebalo y luego envia a prod, haz bump, release y todo").
