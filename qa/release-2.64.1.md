# Release 2.64.1

- **Equipo/dispositivo:** sin prueba en teléfono real todavía — hotfix verificado por código + consulta directa a la base de dev (no un tap físico en el teléfono).
- **Versión de origen:** 2.64.0 (la publicada en prod).
- **Qué se probó:** se leyó la migración real del padre (`sql/2026-11-03-dh1-chofer-privado-quita-wall.sql`) que quitó el gate de `vehiculo_autorizaciones` en `iniciar_uso_vehiculo`; se confirmó que el pool compartido de vehículos de la app (`VehiculosService.getVehiculosDisponiblesDetailed`) recortaba a cero vehículos para chofer_privado sin autorizaciones (causa real del bloqueo de Felix); se quitó ese recorte + los atajos que asumían el pool pre-filtrado (`vehiculo-picker.ts`, `reporte-semanal.ts`); se confirmó contra `sgc-dev` que la consulta de vehículos activos devuelve resultados no vacíos; `npm run build` + `ng test` (63/63) verdes.
- **Resultado:** OK — hotfix de un bug bloqueante real (chofer_privado no podía tomar ningún vehículo), priorizado para salir rápido con el visto bueno explícito de Xaviel de avanzar sin pausas de confirmación.
- **Fecha:** 2026-11-03.

OK: Xaviel escribió "this is a hot fix, so u are supposed to do it fast and without being stopping to ask me confirmations" — autorización explícita para saltar la pausa de prueba en teléfono y avanzar dev→prod de corrido, 2026-11-03.
