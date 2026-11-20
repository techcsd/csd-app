# Release 2.71.5
- Equipo/dispositivo: Samsung SM-A205U (Android 10), teléfono de Xaviel; Chrome + PWA dev servida desde el código de la 2.71.5 (`ng serve` por `adb reverse`)
- Versión de origen: 2.71.4 (la actualización in-app 2.71.4 → 2.71.5 NO se probó antes de prod: el APK dev del teléfono pide un PIN que Claude no conoce; el dev detecta la 2.71.5 («Hay una versión nueva disponible (2.71.5)»). Se prueba en el APK prod justo después de publicar, como en 2.71.4.)
- Qué se probó: con el teléfono «en línea» pero el servidor inalcanzable (proxy del sistema muerto), «Buscar actualización» muestra «No pude conectar con el servidor para ver si hay una versión nueva. Prueba con Wi-Fi u otra red, o más tarde.» En el mismo estado el perfil dice «Conexión: En línea». Build verde, 87/87 tests.
- Resultado: PARCIAL — mensaje verificado en teléfono; sin probar antes de prod: actualización in-app desde 2.71.4; la rama «Sin señal» (offline real) no se re-probó (código sin cambios).
- Fecha: 2026-11-20
**OK de Xaviel** 2026-11-20: «release 2.71.5 now, I give my ok» (main/prod).
