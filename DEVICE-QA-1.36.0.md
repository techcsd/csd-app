# Device-QA — CSD App v1.36.0 (PROMPT-10 · Ronda 29/07)

Validación en teléfono real (rolling: se actualiza al reabrir; no forzada). Donde diga **web**, verificar en SGC. Rollback al final.

## 1. Outbox / telemetría (AA1)
- [ ] "Pendientes de envío" **no** muestra items `error_report`; al reabrir siguen sin aparecer.
- [ ] Con la app un rato en uso, la bandeja no acumula reportes; el badge de sync no cuenta telemetría.

## 2. Reporte semanal (AA3)
- [ ] Envía el reporte de un vehículo (incluido uno **no asignado a ti**) → tras "Enviando…" queda **Reportado** al instante y sigue reportado al salir/volver. **Web:** aparece en el cumplimiento semanal.

## 3. UI (AA4/AA5)
- [ ] **Tecnología** e **Historial de checklists** con estilo estándar (header azul, cards claras, tabs/chips) — como el hub de Transporte.
- [ ] En Historial de checklists, el filtro "🔴 Con hallazgos (N)" muestra el N correcto y cuadra con las cards.

## 4. Voz que se pierde (AA12)
- [ ] En incidente y en bitácora: graba una nota → Siguiente → Volver → **reproduce bien** → envía bien. Repetir en reporte semanal / pre-uso.

## 5. Fotos solo-cámara (AA15)
- [ ] En pre-uso, reporte semanal y foto de tarea de cronograma: el photo-slot **no** ofrece galería (solo cámara).

## 6. Menú principal (AA6/AA7)
- [ ] Home: "❓ Dudas y guías" abre Tecnología en Dudas (con buscador). "🌐 Visitar página web" abre sgcconstructorasd.com en el navegador. Ambos **encima** de "Reportar problema".

## 7. Bitácora ingeniero (AA11)
- [ ] Paso 9: el ingeniero viene **precargado** con el encargado de la obra; es **obligatorio** (no deja avanzar vacío); se puede cambiar. **Web:** el ingeniero llega en la bitácora.

## 8. Combustible Regular/Premium + precio (AA20)
- [ ] Paso 2: tras Gasolina/Diésel pide **Regular/Premium** (obligatorio) y muestra el **precio oficial vigente** (MICM). Con señal muestra el precio; sin señal, el último cacheado.
- [ ] Registra una echada → **web:** el subtipo aparece y **concilia** por producto canónico con el reporte Total Energies.

## 9. Transcripción de voz (AA22)
- [ ] En "Mi registro" (reporte semanal / pre-uso) con una nota de voz: aparece la **transcripción** bajo el player (o "Transcribiendo…" si aún no está).

## 10. Sin regresiones
- [ ] Bitácora, pre-uso, combustible, incidente, reporte semanal, outbox (captura offline → sync) sin romperse.

## Rollback
```sql
update sgc.app_versiones set publicada=true  where plataforma='movil' and version='1.35.0';
update sgc.app_versiones set publicada=false where plataforma='movil' and version='1.36.0';
```
(Ninguna versión está forzada como mínima, así que despublicar 1.36.0 basta.)
