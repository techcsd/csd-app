# Release 2.71.3
- Equipo/dispositivo: Xiaomi M2101K6G (teléfono de Xaviel), Chrome + PWA servida desde el código de la 2.71.3
- Versión de origen: 2.71.2 (la actualización in-app APK 2.71.2 → 2.71.3 NO se probó; en el teléfono hay APK prod 2.66.2 y APK dev 2.26.1-dev)
- Qué se probó: conteo en dev con modo avión (Pendiente de sincronizar), barra global «Sin señal · 1 se enviarán solos» fuera de Conteo, reenvío automático «Todo enviado» ≈40 s tras volver la señal, y existencia 999 confirmada en `stock_por_bodega` de dev. Detalle y lo NO probado: `qa/release-2.71.2-prueba-telefono.md` (sección «Verificación asistida»). Build + `ng test` 68/68.
- Resultado: PARCIAL — flujo principal OK; sin probar: actualización in-app, estado «Falló», aviso >2 min, barra `stale`, badge de Inventario, auto-reparación tras deploy.
- Fecha: 2026-11-20
**OK de Xaviel** 2026-11-20: «push everything to main(prod) i allows u to do it. --yes» (se salta las 24 h en dev).
