# BK5 — Límites de fotos (mínimos y máximos) — inventario y decisiones

Ronda BK / PROMPT-37 FASE 3. Documenta dónde viven los límites de fotos, qué se
decidió y qué quedó pendiente del padre. **Decisiones tomadas con Xaviel (07/09/2026).**

## 1) Mínimo de fotos por captura — sigue HARDCODEADO (knob del padre NO existe)

El plan era: cuando el padre (PROMPT-36 / SGC) creara un parámetro configurable
`bitacora_min_fotos`, la app lo leería en vez de la constante. **El padre NO creó ese
knob** — el mínimo sigue siendo un `constant int` en los RPC de bitácora del server
(`c_min_fotos_parte := 2`, `c_min_fotos_incidente := 1`). Por eso la app **mantiene sus
constantes** (espejo fiel del server); cambiarlas a un knob inexistente solo crearía un
desajuste cliente↔server. Reabrir cuando el padre publique el parámetro.

Sitios del mínimo en ESTA app (4 — más web y 4 del server):
- `src/app/pages/bitacora/parte/parte.ts` → `MIN_FOTOS = 2`
- `src/app/pages/bitacora/incidente/incidente.ts` → `MIN_FOTOS = 1`
- `src/app/pages/inventario/recibir/recibir.ts` → `MIN_FOTOS = 2`

> Si el padre añade `bitacora_min_fotos` (parámetro), leerlo vía el catálogo de
> parámetros y sustituir las 3 constantes por ese valor (con la constante como respaldo).

## 2) Máximos de fotos POR FORMULARIO — se QUEDAN en código (decisión explícita)

**Decisión (Xaviel): dejarlos en código y solo documentar.** Son límites de **UX por
pantalla** (cuántos slots pintar), NO política. Conectarlos al parámetro global
`bitacora_max_fotos = 40` degradaría cada formulario (una charla no necesita 40 slots).
El `bitacora_max_fotos = 40` sigue siendo el **techo del server** (política real).

Los 9 máximos por formulario (todos intencionales):
| Archivo | Constante | Valor |
|---|---|---|
| `pages/obra/charla/charla.ts` | `MAX_FOTOS` | 2 |
| `pages/obra/checklists/checklists.ts` | `MAX_FOTOS` | 3 |
| `pages/obra/incidente/incidente.ts` | `MAX_FOTOS` | 3 |
| `pages/obra/logistica/logistica.ts` | `MAX_FOTOS` | 2 |
| `pages/obra/no-conformidad/no-conformidad.ts` | `MAX_FOTOS` | 3 |
| `pages/transporte/mantenimiento/mantenimiento.ts` | `MAX_FOTOS` | 3 |
| `pages/transporte/mantenimiento-cierre/mantenimiento-cierre.ts` | `MAX_FOTOS` | 2 |
| `pages/transporte/reportar-vehiculo/reportar-vehiculo.ts` | `MAX_FOTOS_HECHO` | 6 |
| `pages/obra/subcontratistas/subcontratistas.ts` | `MAX_SOPORTES` | 3 |

## 3) Duplicados entre repos (app ↔ web) — anotados, NO unificados en esta ronda

Constantes iguales que viven en dos repos. No se tocan ahora (unificarlas requiere un
paquete compartido o un parámetro de servidor); se anotan para no perderlas de vista:
- **Duración máx. de impersonación = 1 h**: `src/app/core/services/impersonation.service.ts:44`
  y su gemela en la web.
- **`STALE_MIN = 10`** (seguimiento "sin señal"): `pages/transporte/seguimiento/seguimiento.ts:80`
  y su gemela en la web.
- **Largo del PIN = 6**: `pages/auth/pin-acceso-change/pin-acceso-change.html`,
  `shared/components/generar-acceso/generar-acceso.html`, más dos sitios de la web.

> Candidatos a un parámetro de servidor (`sgc.parametros`) si alguna vez cambian: la
> duración de impersonación y el largo del PIN son los más "de política".
