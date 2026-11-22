# Release 2.71.6
- Equipo/dispositivo: ninguno — SIN prueba en teléfono real antes de publicar (no hay iPhone ni Samsung conectado en esta sesión). Verificado solo por build + 86/87 tests + guards + inspección del bundle (sin lookbehind de código propio).
- Versión de origen: 2.71.5 (la actualización in-app 2.71.5 → 2.71.6 NO se probó antes de prod; se prueba en el APK prod y en un iPhone justo después de publicar, como en 2.71.4/2.71.5).
- Qué se probó: build verde con todos los guards (incl. verify-compat-ios nuevo); fix del outbox (`outboxPorTipo`) sin prueba funcional en dispositivo; pantalla de rescate de arranque (index.html), Dexie con reintento y banner, y regex sin lookbehind SIN probar en iOS < 16.4 ni con IndexedDB roto real.
- Resultado: OK parcial — compila y pasa guards; comportamiento en dispositivo pendiente de verificar tras publicar. Test pre-existente `estadoLicencia` falla de noche por zona horaria (ajeno).
- Fecha: 2026-11-21
**OK de Xaviel** 2026-11-21: «promueve la 2.71.6 a main» (main, sin prueba previa en teléfono; se acepta el riesgo).
