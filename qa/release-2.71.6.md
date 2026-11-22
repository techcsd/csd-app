# Release 2.71.6
- Equipo/dispositivo: iPhone y Android de Xaviel — Xaviel reporta (2026-11-21) que probó la app en su iPhone y en su Android; el detalle de esa prueba lo aporta él, no está documentado aquí. Además, Claude abrió el build 2.71.6 (`dist` servido por `adb reverse`) en Chrome de un Xiaomi M2101K6G (Android 13): arranca y muestra el login, sin pantalla blanca ni pantalla de rescate. Con la app de prod 2.71.4 instalada en ese teléfono (no se instaló el APK 2.71.6; no se probó con PIN/sesión ni IndexedDB roto).
- Versión de origen: 2.71.5 (la actualización in-app 2.71.5 → 2.71.6 no consta como probada antes de prod; verificarla con el APK prod tras publicar).
- Qué se probó: build verde con todos los guards (incl. verify-compat-ios nuevo); fix del outbox (`outboxPorTipo`) sin prueba funcional en dispositivo; pantalla de rescate de arranque (index.html), Dexie con reintento y banner, y regex sin lookbehind SIN probar en iOS < 16.4 ni con IndexedDB roto real.
- Resultado: OK parcial — compila y pasa guards; comportamiento en dispositivo pendiente de verificar tras publicar. Test pre-existente `estadoLicencia` falla de noche por zona horaria (ajeno).
- Fecha: 2026-11-21
**OK de Xaviel** 2026-11-21: «promueve la 2.71.6 a main» (main, sin prueba previa en teléfono; se acepta el riesgo).
