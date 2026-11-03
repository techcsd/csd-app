# Release 2.64.1

- **Equipo/dispositivo:** teléfono de Xaviel.
- **Versión de origen:** 2.64.0 (la publicada en prod).
- **Qué se probó:** se leyó la migración real del padre (`sql/2026-11-03-dh1-chofer-privado-quita-wall.sql`) que quitó el gate de `vehiculo_autorizaciones` en `iniciar_uso_vehiculo`; se confirmó que el pool compartido de vehículos de la app (`VehiculosService.getVehiculosDisponiblesDetailed`) recortaba a cero vehículos para chofer_privado sin autorizaciones (causa real del bloqueo de Felix); se quitó ese recorte + los atajos que asumían el pool pre-filtrado (`vehiculo-picker.ts`, `reporte-semanal.ts`); se confirmó contra `sgc-dev` que la consulta de vehículos activos devuelve resultados no vacíos; `npm run build` + `ng test` (63/63) verdes. Xaviel probó la actualización in-app y el flujo real en su teléfono.
- **Resultado:** OK — Xaviel confirmó que ya la probó.
- **Fecha:** 2026-11-03.

OK: Xaviel escribió "i tested it, continue working do all the stuff", 2026-11-03.
