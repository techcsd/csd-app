# Revisión de combustible — septiembre 2026 (lado APP)

> CD8 (nota #99). Revisión a fondo del flujo de echadas **en la app móvil** y su
> paridad con la web. El lado servidor/web (consulta de duplicados en prod, unicidad
> por recibo, herramienta *Posibles duplicados*, export 1 fila por echada) lo cubre el
> PADRE (SGC) en `docs/REVISION-COMBUSTIBLE-2026-09.md` + `sql/2026-09-30-cd8-
> combustible-integridad.sql`. Aquí van los hallazgos y arreglos **de la app**.
>
> App **2.37.0**. Contratos consumidos verificados vivos en `sgc-dev`:
> `registrar_combustible_app` (idempotente por `client_uuid`, línea 173), `reenviar_
> echada` (idempotente por `(reenvio_de, client_uuid)`), `echada_detalle`,
> `log_combustible` (elevado), política `registros_combustible: select` (CD5).

## Resumen

La app **no** es una fuente independiente de duplicados: escribe SIEMPRE por el outbox
con un `client_uuid` que es a la vez el id de la op (persistido en Dexie antes de
sincronizar). Los reintentos de una misma op reusan ese id → el servidor los dedupe. El
único camino con idempotencia **incompleta** era el **reenvío** de una echada rechazada:
generaba un `client_uuid` nuevo por cada pulsación, así que dos envíos del mismo rechazo
creaban dos reenvíos. Arreglado en 2.37.0.

## Hallazgos

| # | Severidad | Hallazgo | Estado / Arreglo |
|---|---|---|---|
| A1 | 🔴 Alta | **Reenvío sin idempotencia estable.** `reenviarEchada()` usaba `crypto.randomUUID()` por llamada. Doble pulsación / reabrir la pantalla → dos ops con `client_uuid` distinto → el servidor (idempotente por `(reenvio_de, client_uuid)`) creaba **dos** reenvíos de la misma echada rechazada (CD8 hipótesis #2). | **Arreglado.** `client_uuid = uuidV5('reenvio:<originalId>')` (determinista). Misma echada reenviada → mismo id → el outbox sobrescribe la op y el servidor devuelve el reenvío ya creado. `src/app/core/util/uuid.ts`, `combustible.service.ts:reenviarEchada`. |
| A2 | 🟠 Media | **Sin aviso previo de posible duplicado.** El chofer podía registrar dos veces el mismo recibo o repetir una echada casi idéntica sin que nada lo avisara antes de enviar. | **Arreglado (aviso suave, no bloquea).** `posibleDuplicado()` avisa antes de encolar si el mismo vehículo ya tiene el mismo `numero_recibo` (CC6) o una echada de la misma fecha con galones ±0.5 % (±0.3 gal): *"¿Es la misma echada que registraste a las HH:MM?"*. **Solo online** (offline no se chequea: el servidor dedupe por recibo/`client_uuid`). `combustible.service.ts:posibleDuplicado`, `combustible.ts:submit`. |
| A3 | 🟢 Baja | **Crear e importar ya eran idempotentes.** `registrar_combustible_app` dedupe por `client_uuid` (SGC `br1:173`); el id de la op es estable entre reintentos de red. La importación de factura (BT1, `importada=true`) es camino del padre. | Sin cambios en la app. Verificado. |
| A4 | 🟢 Baja | **Corregir una op atascada** genera un `client_uuid` nuevo a propósito: la echada vieja fue rechazada **pre-inserción** (no existe fila en el servidor) y la op original se cancela tras encolar la corregida (sin ventana de pérdida). No duplica. | Correcto por diseño (BM1). Documentado. Distinto de A1: A1 es post-rechazo del servidor (fila real), A4 es pre-inserción. |
| A5 | 🟠 Media | **CD5 — el chofer no veía las echadas de su vehículo, solo las suyas.** La ficha mostraba KPI en 0 y no había lista de *Echadas del vehículo*. | **Arreglado (consume CD5).** El padre corrigió la política `registros_combustible: select` (overload `puede_ver_echada(registrado_por, conductor_id, vehiculo_id)` que reusa `puede_ver_vehiculo`). La app añade *Echadas del vehículo* en la ficha (`getEchadasVehiculo` por `vehiculo_id`, RLS-gated) y el KPI (v_vehiculo_stats/`getUltimaEchada`) ahora se llena para el chofer. `perfil-vehiculo`. |
| A6 | 🟡 Pendiente (padre) | **CC6 — `numero_recibo` no se persiste.** La app **captura** el nº de recibo y lo guarda en el borrador/registro local, pero `registrar_combustible_app` aún **no** expone `p_numero_recibo`: el envío degrada tras comprobación de capacidad (PGRST202). Sin el recibo en la fila, la unicidad parcial `(vehiculo_id, numero_recibo)` y el aviso A2-recibo no tienen dónde casar en los que ya se enviaron. | **Owed por el padre.** Cuando añada `p_numero_recibo`, la app lo persiste sin cambios (la capability-fallback ya está). Ver memoria *cc-round-parent-gap-numero-recibo*. |
| A7 | 🟢 Baja | **KM del outbox reconciliado.** `getUltimaEchada` cruza el último km con el máximo pendiente en el outbox (`maxKmPendiente`) para no mostrar un salto falso antes de sincronizar. | Correcto. Verificado. |
| A8 | 🟢 Baja | **Rendimiento / costo/km.** La ficha usa `v_vehiculo_stats` (server) + `rendimiento_esperado` del detalle. No recalcula en cliente ni cuenta echadas de prueba (`es_prueba` excluido en las lecturas de la app). Tras CD5 refleja lo del vehículo, no solo lo del chofer. | Correcto. |
| A9 | 🟢 Baja | **Paridad web↔app.** El detalle de echada usa el RPC definer `echada_detalle` (no lectura directa), igual que la web. *Registro de echadas (log)* usa `log_combustible` (elevado) igual que la web. *Mis echadas* (chofer) es lectura directa por `conductor_id` bajo RLS. | Consistente. |

## Notas de prueba (idempotencia — QA)

- **Reenvío doble (online):** reenviar una echada rechazada, volver atrás y reenviar
  otra vez → **un solo** reenvío en el servidor (mismo `client_uuid` v5). Antes: dos.
- **Reenvío con red cortada:** reenviar offline → la op queda en el outbox con el id
  estable; al reconectar sincroniza una vez; si se reintenta el drenado, el servidor
  devuelve el reenvío existente (idempotente). Sin duplicado.
- **Crear con reintento doble:** encolar una echada, forzar reintento del outbox →
  `registrar_combustible_app` dedupe por `client_uuid`: una sola fila.
- **Aviso de duplicado (online):** registrar una echada; intentar otra del mismo
  vehículo, misma fecha y galones casi iguales → aparece *"¿Es la misma echada que
  registraste a las HH:MM?"*. Offline: no aparece (no bloquea el trabajo de campo).
