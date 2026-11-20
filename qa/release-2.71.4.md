# Release 2.71.4
- Equipo/dispositivo: Xiaomi M2101K6G (teléfono de Xaviel), Chrome + PWA servida desde el código de la 2.71.4 contra dev; prueba de persistencia por script contra prod
- Versión de origen: 2.71.3 (la actualización in-app se probó DESPUÉS del release: APK prod 2.66.2 → 2.71.1 → 2.71.4 en el teléfono de Xaviel, 20-nov; APK dev 2.26.1-dev sin tocar)
- Qué se probó: en teléfono contra dev (modo Odoo forzado, dev no tiene almacenes Odoo): nota + botón «Aplicar como conteo físico», confirmación, «Ajuste aplicado», conteo físico `aplicado` y stock 0→3 (luego deshecho con conteo_fisico_deshacer). En prod, por script versionado (`scripts/diagnosticos/2026-11-20-dt-t1b-persistencia-odoo.mjs`): +1 por Conteo físico en un almacén Odoo, 12 min vigilado, NO lo revirtió Odoo; revertido a 0. 87/87 tests, build verde.
- Resultado: PARCIAL — flujo y persistencia OK; sin probar: ajuste real desde el teléfono contra un almacén Odoo, saldo en Odoo (SGC confirma el evento sincronizado; Xaviel debe verlo en Odoo), almacén sin Odoo tras el cambio. Probado después: actualización in-app 2.66.2→2.71.1→2.71.4, vista como Raykler (nota + botón) y rechazo sin señal.
- Fecha: 2026-11-20
**OK de Xaviel** 2026-11-20: «1. Ok, 2. Ok, 3. Ok --yes» (merge a dev + APK dev, prueba en prod, y main/prod).
