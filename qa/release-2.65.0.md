# Release 2.65.0

- **Equipo/dispositivo:** teléfono de Xaviel.
- **Versión de origen:** 2.64.1 (la publicada en prod).
- **Qué se probó:** ronda DH (PROMPT 133) — mensajes de bloqueo de kilometraje enriquecidos con fuente/fecha/km en Combustible y Mantenimiento; GPS serializa `GeolocationPositionError` y reintenta con menor precisión en timeout; lote de tracking (`registrar_posiciones`) ya no se atasca para siempre en rechazo permanente; condición de carrera real en la suscripción al canal de notificaciones (doble `subscribe()`) corregida; Dudas ya no parpadea "sin resultados" (loading por tab en Tecnología); Reportes de errores pagina con "Cargar más" y ya no mezcla errores de negocio (fecha pasada, conduce no despachado, etc.) con bugs técnicos reales; nuevo interruptor "Requisiciones por correo" en Avisos › Preferencias; renglones de cotización (leídos por IA) visibles en el detalle; saludo inicial de Compa ahora descartable ("Ocultar"). `npm run build` + `tsc --noEmit` verdes. Xaviel probó la actualización in-app desde 2.64.1 en su teléfono real.
- **Resultado:** OK — Xaviel confirmó "funciona bien".
- **Fecha:** 2026-11-03.

OK: Xaviel escribió "si, funciona bien. hazlo", 2026-11-03.
