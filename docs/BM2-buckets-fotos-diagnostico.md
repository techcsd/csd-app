# BM2 — Diagnóstico de buckets de Storage (aporte del hijo al padre)

**Ronda 09/09/2026 · PROMPT-41 FASE 3 · sin cambios de código.**
Insumo para `PROMPT-40-SGC.md` FASE 3 (declarar en `sql/` los buckets creados desde
el dashboard). La app **no** declara buckets; los usa. Aquí está el inventario real
de sitios que escriben a cada bucket, para que el auditor del padre los declare
completos (RLS INSERT **y** UPDATE — se sube con `upsert:true`, ver
`storage-upsert-needs-update-policy` en memoria).

## Punto ciego confirmado
El bucket **`vehiculos`** (y **`conduces`**) **no está en `sql/`** — se creó desde el
dashboard. La app depende de ambos pero el repo no los versiona. Ese es el hueco que
cierra el padre.

## Rutas de las fotos de combustible (lo que BM2 necesita)
- **Subida** (encolado): `core/services/combustible.service.ts:330`
  → `bucket: 'vehiculos'`, path `combustible/<opId>/{recibo|tablero|bomba}.jpg`
  (estación) o `combustible/<opId>/evidencia.jpg` (depósito en obra).
- **Upload real** (drain): `core/sync/sync.service.ts:752-754`
  → `.storage.from(foto.bucket).upload(path, body, { upsert: true, contentType })`
  con `contentType` ya saneado de parámetros de codec (`rawType.split(';')[0]`, arreglo
  AW13). Un 415/413 de Storage llega **sin** código permanente → `throwSyncError` lo deja
  **transitorio** ("Esperando envío"), nunca "Problema del sistema".

## Bucket `vehiculos` — 19 sitios
| Servicio | Líneas | Uso |
|---|---|---|
| `mantenimientos.service.ts` | 137, 166 | firma + fotos de mantenimiento |
| `vehiculos.service.ts` | 777, 784, 791, 841, 849 | fotos de vehículo / evidencias |
| `traspaso.service.ts` | 90, 93, 112 | firma + fotos de traspaso de acta |
| `conduces.service.ts` | 816 | foto de parada |
| `combustible.service.ts` | 330 | **recibo/tablero/bomba/evidencia de echada** |
| `reporte-semanal.service.ts` | 217, 220, 225, 228 | firma + fotos/audios de checklist |
| `checklist-preuso.service.ts` | 62, 70, 83 | firma + fotos de pre-uso |

## Bucket `conduces` — 21 sitios
| Servicio | Líneas | Uso |
|---|---|---|
| `inventario.service.ts` | 927, 1000, 1003, 1053, 1056 | devolución + recepción tardía |
| `conduces.service.ts` | 819, 1173, 1184, 1225, 1228, 1231, 1303, 1306, 1394, 1397, 1400, 1465, 1786, 1789, 1866, 1867 | conduce simple/externo, entrega, confirmación, transferencias, parada-firma |

## Descartado explícitamente (nota para el padre)
La **compresión unificada de BJ** (`0613b10`, app 2.13.0) **no** puede haber causado
la tarjeta "Problema del sistema" de la captura: un 415/413 de Storage no trae código
permanente, así que `throwSyncError` lo clasifica **transitorio**, no permanente. La
tarjeta de la captura era `estado:'error'` con `intentos:1` → eso solo lo produce un
código `22|23|42` del RPC de negocio (`registrar_combustible_app`), no Storage.
