# Auditoría de borradores + fotos en capturas (BT4/BT5, regla 17 corolario)

Toda captura con fotos debe **guardar borrador desde la primera tecla** y **persistir las
fotos ya tomadas** (en `borrador_fotos`/IndexedDB), para que un cierre de la app (Safari
mata la pestaña por memoria, Android recrea la Activity al volver de la cámara) **no pierda
nada**: al reabrir, el formulario y las fotos se recuperan.

Servicio único: `BorradorService` (`save`/`load` + `saveFoto`/`loadFotos`) vía
`AutosaveService` (debounce 600 ms + flush en `visibilitychange`/`pagehide`). Patrón de
referencia: `pages/obra/incidente`.

Leyenda: **foto** = captura fotos · **borrador** = autoguarda el formulario ·
**fotos-draft** = persiste las fotos en el borrador (se recuperan tras reinicio).

| Pantalla | foto | borrador | fotos-draft | restaura tras reinicio | Estado |
|---|:--:|:--:|:--:|:--:|---|
| transporte/conduce-externo | ✅ | ✅ | ✅ | ✅ | **BT4 — arreglado esta ronda** |
| transporte/generar-conduce | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| transporte/reportar-vehiculo | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| transporte/reportar-multa | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| transporte/preuso | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| transporte/reporte-semanal | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| obra/incidente | ✅ | ✅ | ✅ | ✅ | referencia |
| obra/no-conformidad | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| obra/charla | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| bitacora/parte (parte diario) | ✅ | ✅ | ✅ | ✅ | ya cumplía |
| **transporte/combustible** | ✅ | ❌ | ❌ | ❌ | **owed** — no tiene borrador (las fotos viven en signals; un cierre pierde la echada) |
| **inventario/retiro-nuevo** | ✅ | ❌ | ❌ | ❌ | **owed** — sin borrador |
| ingenieria/cartilla/cartilla-nueva | ✅ | ✅ | ❌ | parcial | **owed (parcial)** — guarda el formulario; las fotos se re-toman al reanudar |
| transporte/checklist | ✅ | ✅ | ❌ | parcial | **owed (parcial)** — idem |
| inventario/entrada | ✅ | ✅ | ❌ | parcial | **owed (parcial)** — idem |
| inventario/recibir | ✅ | ✅ | ❌ | parcial | **owed (parcial)** — idem |

## Prioridad de los pendientes (owed)
1. **transporte/combustible** — flujo frecuente y sin borrador alguno (el mayor riesgo tras
   conduce-externo). Añadir `autosave.queue` del snapshot + `saveFoto` de recibo/tablero/
   bomba/evidencia + `restoreDraft`, cuidando el modo corrección (`?corregir=`), depósito y
   persona. Es un wizard grande (807 líneas) → merece su propia tanda con device-QA.
2. **inventario/retiro-nuevo** — sin borrador.
3. **cartilla-nueva / checklist / entrada / recibir** — ya guardan el formulario; solo falta
   `saveFoto`/`loadFotos` para que las fotos también sobrevivan al cierre.

> Esta ronda cerró el caso agudo REPORTADO (conduce-externo: crash al tomar foto + pérdida
> total del formulario). El resto son mejoras del mismo patrón, aplicables incrementalmente.
