# Release 2.71.0

- Equipo/dispositivo: Samsung SM-A205U (Android 10), APK dev conectado por adb; backend dev.
- Versión de origen: 2.70.0 (APK dev 2.70.0 instalado en el teléfono; la app detectó la 2.71.0 publicada y mostró el aviso «Hay una versión nueva (2.71.0)»). La instalación de 2.71.0 sobre 2.70.0 se hizo con `adb install -r` (misma llave de firma; sesión y PIN se conservaron). NO se ejercitó el botón del instalador in-app (ApkInstaller): este release no toca el actualizador.
- Qué se probó: QR del conduce → enlace → PIN → recepción de esa salida; recepción «Sí, todo» (cantidades 4 y 10 quedan guardadas, estado `entregado`); «Faltó algo» (bloquea sin bajar cantidad; con 6/10 queda `entregado_incompleto`); chip «Pendiente de registrar» vía `conduce_estado_sync`; `appUrlOpen` con la app abierta. NO se probó en el teléfono: motivo de rechazo obligatorio (el QA no tiene módulo de compras), asistente de GPS (exige el asistente de 8 pasos de Crear conduce), medición de tiempos de arranque.
- Resultado: OK con límites (ver arriba)
- Fecha: 2026-11-17

**OK de Xaviel** 2026-11-17: autorizó en el chat mergear y publicar 2.71.0 a prod ("hazlo entonces. y saca a produccion", "tienes mi ok").
