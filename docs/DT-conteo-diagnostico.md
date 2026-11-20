# DT — Conteo de Raykler: diagnóstico del lado app (PROMPT-151, 20-nov-2026)

Alcance: solo la app (csd-app). Lectura del código en `origin/dev` @ `7767295` (2.71.2). **No se probó en teléfono.**
Leyenda: **Confirmado** = visto en el código; **Supuesto** = hipótesis sin evidencia de runtime.

## T1 — Aviso «Odoo manda el stock» (RESUELTO en 2.71.4, 20-nov-2026)

**Resuelto:** SGC (PR #225) dejó `sgc.bodegas_fuente_stock()` → `table(bodega_id uuid, fuente_odoo boolean)` en dev y prod (prod: 29 almacenes, 16 con Odoo; dev: 28 y 0). Decisión de Xaviel: **Odoo manda el stock (opción A)**; `registrar_conteo_app` no cambia ni publica a Odoo.
- `InventarioService.getBodegasFuenteOdoo()` llama el RPC (cacheado offline) y devuelve `{ bodega_id: true }` solo de los `true`. **Nunca lanza**: `false`/null/undefined, fila rara, error de red/RPC, offline sin caché o `PGRST202` ⇒ `{}` = «desconocido» = sin aviso (con `PGRST202` se ignora hasta una caché vieja).
- `ConteoPage` lo pide en segundo plano al abrir (no bloquea) y `avisoOdoo` = almacén elegido con `true` ⇒ nota persistente sobre la lista; **no bloquea Guardar** y no toca `enqueueConteo`/payload.
- Tests: `inventario-fuente-odoo.spec.ts` (9). Probado en teléfono contra dev solo con el aviso forzado (dev no tiene almacenes Odoo); con datos reales de prod está **sin probar**.

### (Histórico) contrato que se pidió a SGC antes de que existiera

**Confirmado:** la app no conoce `fuente_odoo` por almacén. `grep -ri "fuente_odoo|odoo_corte"` sobre `src/` = 0 resultados; `Bodega` (`inventario.model.ts`) solo trae `id, nombre, es_central, es_principal, proyecto_id`, y `conteo.ts` obtiene las bodegas por el servicio de inventario sin ningún campo de fuente de stock. No se consulta `odoo_corte_bodega` desde el cliente y no se inventó ningún RPC.

**Contrato que pide la app a SGC (mensaje para la sesión SGC):**

- Opción A (preferida, mínima): añadir `fuente_odoo boolean` a lo que ya devuelve la lista de bodegas que usa Inventario › Conteo (la misma fuente de `bodegas()`), calculado en servidor con `exists(select 1 from sgc.odoo_corte_bodega where bodega_id = b.id and fuente_odoo)`.
- Opción B: RPC nuevo `bodegas_fuente_stock()` → `table(bodega_id uuid, fuente_odoo boolean)`, `security definer`, con grants a `authenticated`, legible por cualquier rol con módulo `inventario` (es dato no sensible; solo un booleano por almacén).
- Debe ser backward-compatible: la app tratará `undefined/null` como «desconocido» (no muestra aviso).
- Si SGC termina haciendo que `registrar_conteo_app` cree un conteo físico aplicado y publicado a Odoo (decisión pendiente de Xaviel), el aviso deja de hacer falta y la app solo debe mostrar el estado real de envío.

**Estado en código:** `TODO(DT-T1…)` en `src/app/pages/inventario/conteo/conteo.ts` (`onBodega`). Copy ya definido (es): «En este almacén Odoo manda el stock: un conteo desde la app puede revertirse en unos minutos. Para un ajuste que quede, usa Conteo físico en la web (nuevo conteo → cerrar → aprobar → aplicar).» — se añadirá con `t()` + en/ht cuando exista el dato. Sin texto técnico (regla 16).

## T2 — Por qué los conteos de Raykler nunca salieron del teléfono

**Dato de partida (SGC):** 0 conteos de la app en 10 días en prod → ninguno llegó al servidor.

### 2.1 `sync.service` + handler `inv_conteo`

**Confirmado:**
- El handler llama `registrar_conteo_app` y envuelve el error con `throwSyncError`. Permanente (SQLSTATE `P0001|22*|23*|42*|DR*`, `PGRST202-205`, RLS): pasa a `error` con motivo (categoría `dato`/`sistema`). Transitorio (red, 401/408/429/5xx): backoff 30s → 1m → 2m → 5m → 5m; a la 6ª falla (~13,5 min) pasa a `error` visible (⚠️) y se puede Reintentar. Nunca se borra solo.
- `registrar_conteo_app` es idempotente por `p_id` (UUID de cliente); reintentar no duplica.
- Cada subida y cada RPC tienen `withTimeout` de 90 s: un envío colgado no congela la cola.
- Una op `syncing` que quedó así por matar la app se vuelve a procesar (el drain solo salta `done` y `error`).
- Bundle viejo: la op guarda `tipo_op`+payload en Dexie; un bundle sin handler lo marca `error` `incompatible` tras 6 intentos (visible). La pantalla vieja (anterior a 2.71.2) decía «guardado» al encolar, así que **el usuario no tenía señal de que seguía sin enviar** (esto es lo que arregló 2.71.2 dentro de la pantalla).
- **DEFECTO REAL #1 (corregido):** `drain()` hacía `await ensureFreshSession()` **sin tope de tiempo**. `refreshSession()` es un `fetch` sin timeout; con señal mala/captive portal puede no resolver nunca → `draining` queda `true` para siempre y **ninguna op se envía** (el ticker y el efecto de «volvió la señal» salen por `if (this.draining) return`) hasta cerrar la app. Las ops quedarían `pending` con ⏳ «se enviará solo» eternamente y sin pasar a `error`. **Supuesto:** que esto le pasó a Raykler — es compatible con «0 llegaron, ninguna en error», pero no hay evidencia de runtime; hay que revisar su teléfono (`/pendientes`) para confirmarlo. Fix: `withTimeout(…, 15 s)` alrededor del refresh (el drain sigue y el error real se clasifica abajo).

### 2.2 ¿Se veía un `inv_conteo` atascado fuera de la pantalla de conteo?

**Confirmado:**
- Barra global `app-sync-bar` (Inicio, Inventario, Bitácora…): contaba `pending`/`error` de TODAS las ops. Un `error` salía como ⚠️ «N … con problema»; un `pending` como ⏳ «N pendientes de enviar» — **sin distinguir** «reintentando normal» de «lleva un buen rato sin que se intente» (caso del drain colgado). **Defecto #2 (corregido):** nuevo estado `stale` (⚠️ «N sin enviar hace rato · toca para revisar») cuando hay `pending` con señal cuyo turno de reintento venció hace > 3 min (`SyncService.sinDrenar`, evaluado en el ticker de 60 s, independiente de que `drain()` termine).
- «En proceso» / badges de tiles (`EnProcesoService`): `inv_conteo` (y `inv_salida/entrada/devolucion_obra`) estaban listados bajo el módulo **`flota`** (AE7), no `inventario`. Un almacenista sin módulo Transporte nunca veía el badge en su tile Inventario; solo el de la barra y `/pendientes`. **Defecto #3 (corregido):** movidos a `inventario` (no se duplican entre módulos; `listAll` ya deduplica).
- Seguía visible siempre en `/pendientes` (lista cruda del outbox).

### 2.3 Auto-reparación de chunk y el outbox

**Confirmado por código:** `UpdateService.autoRepair('chunk_perdido')` / `reparar()` solo hacen `registration.unregister()` + `caches.delete(*)` + `location.reload()`. No hay ninguna llamada a `indexedDB.deleteDatabase`, `db.delete()` ni `db.outbox.clear()` en `src/app/core`. Se respeta el candado de formulario/sincronización activa y el anti-bucle (60 s).
**Test añadido:** `src/app/core/services/update.service.spec.ts` (2 casos: `autoRepair('chunk_perdido')` y `reparar()` — SW desregistrado, caches borradas, IndexedDB/Dexie/outbox intactos).
**No cubierto:** el comportamiento real del SW en un deploy (se prueba en teléfono: ver `qa/release-2.71.2-prueba-telefono.md` §6).

### Cambios (T2)
| Archivo | Cambio |
|---|---|
| `core/sync/sync.service.ts` | refresh de sesión acotado (15 s); `sinDrenar` + `revisarDrenajeVencido()` en el ticker |
| `shared/components/sync-bar/*` | estado `stale` con copy es/en/ht |
| `core/services/en-proceso.service.ts` | `inv_*` pasan de `flota` a `inventario` |
| `core/services/update.service.spec.ts` | nuevo |
| `public/i18n/{en,ht}.json` | 1 clave nueva |

### Qué debe revisar Xaviel / SGC
- En el teléfono de Raykler: `/pendientes` (¿hay `inv_conteo` pendiente/error?) y Perfil › Acerca de (versión instalada). Eso confirma o descarta el supuesto del drain colgado.
- SGC: contrato de T1 (arriba) y la decisión sobre `registrar_conteo_app` ↔ Odoo.
