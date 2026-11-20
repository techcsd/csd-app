# Release 2.71.4
- Equipo/dispositivo: Xiaomi M2101K6G (teléfono de Xaviel), Chrome + PWA servida desde el código de la 2.71.4 contra dev; prueba de persistencia por script contra prod
- Versión de origen: 2.71.3 (la actualización in-app APK 2.71.3 → 2.71.4 NO se probó; en el teléfono hay APK prod 2.66.2 y APK dev 2.26.1-dev)
- Qué se probó: en teléfono contra dev (modo Odoo forzado, dev no tiene almacenes Odoo): nota + botón «Aplicar como conteo físico», confirmación, «Ajuste aplicado», conteo físico `aplicado` y stock 0→3 (luego deshecho con conteo_fisico_deshacer). En prod, por script versionado (`scripts/diagnosticos/2026-11-20-dt-t1b-persistencia-odoo.mjs`): +1 por Conteo físico en un almacén Odoo, 12 min vigilado, NO lo revirtió Odoo; revertido a 0. 87/87 tests, build verde.
- Resultado: PARCIAL — flujo y persistencia OK; sin probar: actualización in-app, ajuste desde el teléfono contra un almacén Odoo real, que Odoo reciba el ajuste, sin señal en almacén Odoo, almacén sin Odoo tras el cambio.
- Fecha: 2026-11-20
**OK de Xaviel** 2026-11-20: «1. Ok, 2. Ok, 3. Ok --yes» (merge a dev + APK dev, prueba en prod, y main/prod).
