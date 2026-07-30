# Device-QA — CSD App v1.36.0 → v1.40.0 (PROMPT-10, IDs AA)

Validación en teléfono real (rolling: se actualiza al reabrir; no forzada). Donde diga **web**, verificar en SGC. Rollback al final. Prioriza el **OUKITEL** para cámara/micrófono.

## 0. Preparación
- [ ] Instala la 1.40.0 (al reabrir la app la ofrece; o descárgala del bucket).
- [ ] Perfil/Ajustes muestra **versión instalada 1.40.0**.
- [ ] Datos: una **obra con estructuras y equipos** definidos; un **vehículo por horas** (horómetro) y uno por km; un usuario **normal** y uno **de Tecnología**. Marca como prueba lo que captures.
- [ ] Para transcripción: confirma que el secret `STT_API_KEY` está puesto en Supabase (si no, la voz se guarda/reproduce igual pero no transcribe).

## 1. Bugs base (1.36.0)
- [ ] **AA1** "Pendientes de envío" NO muestra `error_report`; al reabrir no se acumulan; el badge de sync no los cuenta.
- [ ] **AA3** Envía el reporte semanal de un vehículo (incluido uno **no asignado a ti**) → queda **Reportado** al instante y sigue así al salir/volver. **Web:** aparece en cumplimiento.

## 2. UI estándar (1.36.0)
- [ ] **AA4/AA5** Tecnología e Historial de checklists con estilo estándar (header azul, cards claras, tabs/chips). El filtro "🔴 Con hallazgos (N)" muestra el N correcto (cuadra con las cards).

## 3. Menú principal (1.36.0)
- [ ] **AA6/AA7** En Home, encima de "Reportar problema": "❓ Dudas y guías" (abre Tecnología › Dudas con buscador) y "🌐 Visitar página web" (abre sgcconstructorasd.com en el navegador).

## 4. Bitácora (1.36–1.37)
- [ ] **AA12 voz rehidratada:** graba nota de voz → Siguiente → Volver → **reproduce bien** → envía bien. (Repite en incidente, pre-uso, reporte semanal.)
- [ ] **AA11 ingeniero:** paso 9 viene **precargado** con el encargado de la obra, es **obligatorio** (no avanza vacío), editable. **Web:** llega el ingeniero.
- [ ] **AA8:** las actividades seleccionadas aparecen **arriba** del listado.
- [ ] **AA9 voz por restricción (paso 6):** por cada problema marcado puedes grabar una **nota de voz** (además de foto y descripción).
- [ ] **AA10 fotos de daño (paso 8):** un equipo dañado admite **varias fotos**; el equipo se elige del **catálogo** (sin "Mangosta").
- [ ] **End-to-end offline:** bitácora con estructura + foto+voz en problema + equipo del catálogo con varias fotos de daño → modo avión → reconecta → sincroniza sola. **Web:** todo visible (voz de restricción reproducible + fotos múltiples de daño).

## 5. Reporte semanal (1.37)
- [ ] **AA13:** por cada falla marcada, foto (solo cámara) + nota de voz opcionales. → **Web:** foto+voz por falla en el detalle.

## 6. Captura confiable + permisos (1.36 / 1.39)
- [ ] **AA15 solo cámara:** en pre-uso, reporte semanal y foto de tarea del cronograma el photo-slot **no** ofrece galería.
- [ ] **AA16 micrófono (¡OUKITEL!):** graba **2 notas de voz seguidas** y en **sesiones distintas** → solo pide permiso **la primera vez**.

## 7. Vehículos (1.38 / 1.39)
- [ ] **AA18 crear/editar:** tipo **Telehandler**; **color** y **aseguradora** como lista (Seguros Universal por defecto) + "Otro"; **de obra / de oficina**; medición **km u horas (horómetro)**.
- [ ] **AA18.3 horómetro end-to-end:** crea un **telehandler por horas** → en echar combustible, pre-uso, mantenimiento y reporte semanal el campo dice **"Horas de uso"/"h"** (no km); la regla de no-retroceso aplica igual.
- [ ] **AA19 fotos:** en editar vehículo, **reordenar** (▲▼), **elegir portada** (⭐) y **quitar**; la portada sale en la card y el perfil.

## 8. Combustible (1.36)
- [ ] **AA20:** paso 2 pide **Regular/Premium** (obligatorio) tras Gasolina/Diésel y muestra el **precio oficial vigente (MICM)** (sin señal, el último cacheado). **Web:** el subtipo aparece y **concilia** por producto canónico.

## 9. Transcripción de voz (1.40 / AA22)
- [ ] Con `STT_API_KEY` puesto: tras unos minutos, una nota de voz muestra su **transcripción** (o "Transcribiendo…") en: **Mi registro** (reporte semanal/pre-uso) y **detalle de bitácora/incidente** (app).
- [ ] **Web:** transcripción visible junto al player en el detalle de bitácora (voz general y de restricción) y de checklist/reporte semanal (voz de falla).

## 10. Sin regresiones
- [ ] Bitácora, pre-uso, combustible, incidente, reporte semanal, outbox (captura offline → sync) sin romperse.
- [ ] **Interconexión (regla #1):** las capturas disparan notificaciones/badges/KPIs en la web como antes.

## Rollback (si algo falla)
```sql
-- despublicar 1.40.0 y volver a la anterior sana (p. ej. 1.39.0):
update sgc.app_versiones set publicada=true  where plataforma='movil' and version='1.39.0';
update sgc.app_versiones set publicada=false where plataforma='movil' and version='1.40.0';
```
(Ninguna 1.36–1.40 está forzada como mínima — el piso sigue en 1.34.0 — así que despublicar basta.)
