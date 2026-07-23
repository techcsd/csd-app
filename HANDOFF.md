# HANDOFF — CSD App

## Ronda 8 app — PROMPT-18 / Act.7 (2026-07-23) — v1.27.0 PUBLICADA (NO forzada) (W1–W12)
Source: PROMPT-18 (IDs W1–W12). `CONTEXTO-ACTUALIZACION-7.md` NO estaba en el repo; se trabajó con el detalle inline del prompt (suficiente). **PROMPT-17-SGC YA estaba aplicado** en la BD compartida (verificado por query: existen `entrega_abierta_de`, `stock_articulo_bodega`, `ping_actividad`, `confirmar_recepcion_salida`; tabla `motivos_multa` T9 con 7 filas incl. "Otro"; columna `es_prueba` en 14 tablas incl. `vehiculos` y `conductores`) → **las 8 fases eran adelantables y se hicieron todas**. `npm run build` VERDE (solo warnings NG8102 preexistentes). Commit **`5536847`** en `main` (pusheado → deploy PWA). APK 1.27.0 firmado (cert prod `3c5316d8…df5065`, 8.43 MB) + bucket (`csd-app-1.27.0.apk`+`latest`+`version.json`) + historial Y1 (8 cambios) + `apk_url`. **1.27.0 PUBLICADA, NO forzada** (`publicada=true`, única publicada; 1.26.0 despublicada; **`minima` sigue 1.26.0**) → 1.26.0 recibe actualización OPCIONAL. **Rollback:** `update sgc.app_versiones set publicada=true where plataforma='movil' and version='1.26.0'` + `publicada=false where version='1.27.0'`. Para **forzar** 1.27.0: `update … set minima=true where version='1.27.0'` + `minima=false where version='1.26.0'`.
- **FASE 1 (W1) — Pendientes con diagnóstico útil:** `pendientes.ts` nuevo `detalleLegible()` mapea el `error_msg` crudo (constraint/tabla/fkey/duplicate/RLS/existencia) → frase legible ("El vehículo ya no existe", "Este registro ya fue enviado antes", "No hay suficiente existencia"). El crudo sigue en "Ver detalle técnico". **Reintentar oculto** en errores permanentes (solo Descartar); `hayReintentables()` solo cuenta transitorios. Pre-check `estaActivo` (patrón S29) al abrir `reportar-vehiculo` → banner rojo `refInvalida` + submit bloqueado.
- **FASE 2 (W2) — "Cómo llegar" → Maps nativo:** instalado `@capacitor/app-launcher@8`. `conduces.ts comoLlegar()` usa intent `google.navigation:q=<destino>` (canOpenUrl primero) → fallback URL https; web/PWA siempre https. **GOTCHA:** requiere `<queries>` en `AndroidManifest.xml` (geo/google.navigation/https) o `canOpenUrl` devuelve false en Android 11+ (añadido; memoria [[applauncher-queries-gotcha]]). RutaHoy **no** trae coords → se navega por texto del destino.
- **FASE 3 (W5) — Multas:** motivo = `<select>` del catálogo T9 (`getMotivosMulta`, cacheado offline vía CatalogService `motivos_multa`) + opción "Otro" que abre input libre; default = placeholder (fix T14, "Otro" no queda preseleccionado). Vehículo: reemplazado el `<select>` nativo por el **`vehiculo-picker` en hoja inferior** (nuevo `shared/ui/bottom-sheet`), tus vehículos primero. **Detalle de multa**: `mi-registro-detalle` extendido a `tipo='multa'` (`getMiMultaDetalle`, doc firmado del bucket `flota-documentos`); ruta `/transporte/mi-registro/multa/:id`; tap abre detalle desde **Mi actividad**, **perfil-conductor** y **perfil-vehículo**.
- **FASE 4 (W6/W4) — Galería + orden:** `photo-slot` ahora ofrece **📷 Cámara / 🖼️ Galería** (`pickFromGallery(1)`, con `autosave.flushAll()` antes del picker = fix MIUI U9) — un solo cambio enciende TODOS los flujos por slot (semanal, pre-uso, combustible, mantenimiento, checklist, entrega, inventario entrada/salida, daño). **W4**: `vehiculo-picker` y `reporte-semanal` agrupan "Tus vehículos" (asignaciones + recepciones en cola vía `getMisAsignaciones`+`entregasRecepcionPendientes`) arriba y "Resto de la flota" debajo; pre-uso/combustible/rutas lo heredan del picker.
- **FASE 5 (W3) — Recibir sin bloqueante ciego:** `vehiculos.entregaAbiertaDe()` (RPC `entrega_abierta_de` → `{conductor, es_mia, …}`). `checklist.ts` (solo `tipo='recepcion'`, online) muestra `bloqueoRecepcion`: si **mía** → "Ya tienes este vehículo" + "Ir a devolución"; si **de otro** → "Figura entregado a X" (bloqueo informado). La idempotencia del RPC `crear_entrega_vehiculo` (ya envía `p_id`) evita el error "entrega abierta" en reintentos.
- **FASE 6 (W7) — Datos de prueba:** nuevo `shared/ui/toggle-switch`. Switch "Dato de prueba" (solo `hasRol('admin')`) en `vehiculo-form` y `conductor-form` → `es_prueba`. Badge **PRUEBA** en `vehiculo-card` (pasado desde picker + reporte-semanal). Los no-admin no ven test entities (RLS endurecida de PROMPT-17). Servicios: `VehiculoEditable.esPrueba` + `es_prueba` en getFlota/getVehiculosDisponibles/getVehiculoFull; `conductores.crearConductor/actualizarConductor/getConductor` + `Conductor.es_prueba`.
- **FASE 7 (W8) — Inventario stock/destino/confirmar:** `inventario.stockArticuloBodega()` (RPC `stock_articulo_bodega`). **Salida** (`salida.ts`): stock en vivo por línea ("Hay N unidad en {bodega}"), si cantidad>stock → aviso + "Ajustar a N" (cap) + banner + Confirmar deshabilitado (`hayExceso`), validación previa online antes de encolar; **destino** = `<select>` de obras ("¿Hacia dónde va?", `getObrasConBodega`) → pasa `proyecto_id`. **Entrada**: stock informativo por línea. Offline → "Stock sin verificar (sin señal)", no bloquea. **Confirmar recepción**: la vista ya existe (`inventario/recibir`); **migración aditiva** `sql/2026-07-23-w8-recibir-conduce-autoentrada-destino.sql` (APLICADA) le añade a `recibir_conduce_app` la **entrada automática en el almacén de la obra destino (T15)** conservando la foto de recepción (guarda por `salida_id` + early-return idempotente). El web no usa la variante `_app`.
- **FASE 8 (W12) — Ping de actividad:** `core/services/activity-ping.service.ts` (nuevo) llama `ping_actividad('app')` al abrir + `resume`/`visibilitychange`, throttled ~5 min, solo con sesión y señal, best-effort (sin outbox). Cableado en `app.ts` constructor.
- **Nuevos componentes reutilizables:** `shared/ui/bottom-sheet`, `shared/ui/toggle-switch`, `core/services/activity-ping.service`.
- **GOTCHAS de esta ronda:**
  - `@capacitor/app-launcher` `canOpenUrl` → false sin `<queries>` en el Manifest (Android 11+). [[applauncher-queries-gotcha]].
  - `recibir_conduce_app` (usado por la app) **NO** hacía la auto-entrada T15; solo `confirmar_recepcion_salida` la hacía, pero esa **descarta la foto**. Se resolvió extendiendo `recibir_conduce_app` (aditivo, conserva foto). No migrar la app a `confirmar_recepcion_salida` (perdería la evidencia).
  - Consultas a la BD compartida: `scripts/apply-migration.mjs` **trunca el output a 500 chars**; para leer resultados completos usar un script propio que haga POST al endpoint `…/database/query` con `SUPABASE_ACCESS_TOKEN` (env del sistema).
- **PENDIENTE device-QA (APK 1.27.0 + PWA; necesita teléfono MIUI/JWT real) — nada de código pendiente:**
  - [ ] Maps: "Cómo llegar" abre Google Maps con la ruta al destino (device real, no emulador).
  - [ ] Multa end-to-end: motivo de catálogo + "Otro" + picker de vehículo en hoja + detalle abrible desde Mi actividad/perfiles.
  - [ ] Galería funciona en todos los reportes sin crash MIUI (flushAll antes del picker).
  - [ ] Semanal/pre-uso/combustible muestran "Tus vehículos" arriba.
  - [ ] Salida: muestra stock, no deja prometer más de lo que hay (cap), destino de obra → al confirmar la recepción entra al almacén de la obra (T15).
  - [ ] Recibir el mismo vehículo 2 veces (offline→online) → un solo registro, cero errores en Pendientes; bloqueo claro si ya está recibido por mí/otro.
  - [ ] Con cuenta **chofer**: cero entidades PRUEBA visibles. Con admin: toggle + badge funcionan y los flujos operan con entidades test.
  - [ ] No regresión: outbox drena, borradores/autosave intactos.
  - [ ] (Opcional) Forzar 1.27.0: mover `minima` a 1.27.0 si se quiere obligar la actualización.

## Ronda 7 app — PROMPT-15/16 / Act.6 (2026-07-22 → 23) — v1.25.2 PUBLICADA + MÍNIMA (V1–V8 + V2/V3 cerrado)
Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-6.md` (V1–V8) + `PROMPT-15-CSD-APP.md`. `npm run build` VERDE por fase y final (0 errores; 6 warnings NG8102 preexistentes). Commits en `main`: **`2f12395`** (V1–V8, v1.25.0) → **`000da86`** (detalle de checklist/echada, v1.25.1). APK 1.25.1 firmado (cert prod `3c5316d8…df5065`), subido al bucket `app-releases` (`csd-app-1.25.1.apk` + `latest` + `version.json`), historial registrado (Y1, 9 cambios) + `apk_url`. **1.25.1 PUBLICADA, NO forzada** (`publicada=true`; 1.25.0 y 1.24.0 despublicadas; `version_minima` sigue **1.24.0**) → 1.24.0 recibe actualización OPCIONAL a 1.25.1 (seguro pre-QA); los <1.24.0 siguen forzados. **Rollback:** `update app_versiones set publicada=true where version='1.24.0'` + `publicada=false where version in ('1.25.0','1.25.1')`. **PROMPT-16-SGC NO fue necesario** (V2/V3 con consultas RLS-scoped directas; sin cambios de server).
- **FASE 1 (V1) — borradores/pendientes accesibles:** `EnProcesoService` (nuevo, core) une borradores Dexie + envíos del outbox por módulo (bitácora: tipos `parte`/`incidente` + op `bitacora`; flota: entregas/combustible/preuso/semanal/mantenimiento/ruta/accidente_vehiculo/dano_vehiculo/multa_conductor), reactivo a `sync.changed()`. **Mis bitácoras**: sección "En proceso / Pendientes de envío" (borradores con Retomar/Descartar vía autosave.discard; envíos con estado Enviando/Con problema → /pendientes). Acceso en hub de **Bitácora** (botón con contador) y **Transporte** (tile condicional). Home: `badgeFor` suma avisos + en-proceso por módulo.
- **FASE 2 (V4+V5):** V4 header con back en `combustible.html` cuando `necesitaVehiculo()` (`salirPicker()` → /transporte); no toca el picker embebido. V5 **una sola** `NIVELES_COMBUSTIBLE` (`E·1/4·1/2·3/4·F`) en transporte.model + `NIVEL_COMBUSTIBLE_AYUDA` ("E = reserva · F = lleno") + `nivelCombustibleLabel` (histórico 'Lleno'→'F'); eliminada `NIVELES_COMBUSTIBLE_PREUSO`; pre-uso y semanal reapuntados; recibir/devolver ya la usaba. `.field-hint` global nuevo.
- **FASE 3 (V6+V7+V8):** V6 combustible **4 pasos** (km+galones+monto → estación+cálculo → fotos → resumen); `TOTAL_STEPS=4`, `canAdvance` reagrupado. V7 (verificado) reconciliación semanal server+outbox correcta ("⏳ Enviando…"/"✓ Ya reportado"+"Rehacer"). V8 acciones del ya-asignado apiladas (`asignar__accion`, min-width 190, column); semanal ya apila (vcard trailing column).
- **FASE 4 (V2+V3):** `FlotaReportesService` +`getMisChecklists(tipo)`, `getMisEchadas`, `getMisRutasCreadas` (RLS-scoped; rutas por `auth.getUser().id` = creado_por). "Mi actividad": historiales navegables de semanales/pre-usos/echadas (90 días + "Ver más" → 3650) y "Rutas que creé" para elevados (`esFlotaElevado`).
- **V2 follow-up (v1.25.1) — pantalla de detalle:** `/transporte/mi-registro/:tipo/:id` (`MiRegistroDetallePage`, tipo `checklist|echada`). Checklist: cabecera + respuestas (OK/Falla/NA + comentarios) + fotos + firma; echada: cálculo (precio/gal, recorridos, rendimiento, costo/km) + motivo de alerta + evidencia (recibo/tablero). Métodos `getMiChecklistDetalle`/`getMiEchadaDetalle` (URLs firmadas del bucket `vehiculos`; RLS del chofer confirmada en `checklist_vehiculo_respuestas`/`_fotos`). Las filas del historial de "Mi actividad" ahora navegan al detalle.
- **Cierre V2/V3 + v1.25.2 (2026-07-23):**
  - **Backend (PROMPT-16-SGC):** se crearon 4 RPCs `sgc.mis_reportes_semanales/mis_preusos/mis_echadas/mis_rutas_creadas` (SECURITY DEFINER, scoped por `auth.uid()` vía `mis_conductor_ids`/`creado_por`, excluyen `es_prueba`) y **se eliminaron acto seguido**: la app ya resuelve V2/V3 con selects+RLS directos y quedaron **sin uso** (regla "no dupliques"). **Verificado en prod bajo RLS**: el chofer ve solo lo suyo (Xaviel 9 checklists/7 echadas/9 rutas) y NO ve lo de otros (fuga = 0). Migraciones `sql/2026-07-22-v2v3-historiales-mis.sql` (add) + `…-drop-rpcs-redundantes.sql` (drop), ambas aplicadas + en git (`d36e05c`, `d7b872a`). **Conclusión: V2/V3 no necesita server nuevo.**
  - **App:** los 3 historiales de "Mi actividad" filtran `.not('es_prueba','is',true)` (los registros de prueba salen del historial personal — regla ronda 5). "Rutas que creé" pasó a **filas estáticas con detalle inline** (origen→destino, fecha, placa, conductor, estado); se quitó el tap a `/transporte/conduces` (mostraba rutas asignadas, no las creadas). Commit `79edfee`.
  - **Release:** bump 1.25.1→1.25.2 + `MIN_VERSION` alineado a la mínima real (1.24.0). Commit `8a90574` (push → PWA). APK 1.25.2 firmado (cert prod `3c5316d8…df5065`) + bucket (`csd-app-1.25.2.apk`+`latest`+`version.json`) + historial Y1 (2 cambios) + `apk_url`. **1.25.2 PUBLICADA + MÍNIMA**; 1.25.1 despublicada y 1.24.0 dejó de ser mínima → única fila con flags = 1.25.2. **Rollback:** marcar 1.25.1 (o 1.24.0) `publicada=true,minima=true` y desmarcar 1.25.2.
- **PENDIENTE device-QA (APK 1.25.2 + PWA; necesita teléfono/JWT real):**
  - [ ] Borradores/pendientes en "Mis bitácoras" y accesos desde hubs + contadores del home.
  - [ ] Back en "Elige un vehículo"; nivel "E" en pre-uso/semanal/recibir/combustible; combustible en 4 pasos sin scroll largo.
  - [ ] Semanal (Amarok) offline→online: "Enviando…"→"Ya reportado"+"Rehacer" (no vuelve a "Reportar").
  - [ ] Asignar: acciones legibles y separadas.
  - [ ] Mi actividad: historial de semanales/pre-usos/echadas + "Ver más"; elevado ve "Rutas que creé".
  - [ ] No regresión: outbox drena, borradores intactos, niveles guardados viejos ('Lleno') se leen bien.
  - [ ] Tras QA OK: forzar 1.25.0 (`update app_versiones set minima=true where plataforma='movil' and version='1.25.0'`) si se quiere obligar la actualización.

## Ronda 6 app — PROMPT-14 / Act.5 (2026-07-22) — v1.24.0 PUBLICADA + MÍNIMA (U1–U16)
Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-5.md` (U1–U16) + `PROMPT-14-CSD-APP.md`. `npm run build` VERDE por fase y final (0 errores; 13 warnings NG8102 pre-existentes). **PROMPT-13-SGC ya aplicado** en la BD compartida (verificado: `PRE-USO-V4` y `REPORTE-SEMANAL-V3` activas con etiquetas cortas de 9 secciones×1 ítem). Commit `005543f` + push a `main` (→ deploy PWA) + APK 1.24.0 firmado (cert prod `3c5316d8…df5065`) subido al bucket + historial registrado (Y1, 12 cambios) + `apk_url`. **1.24.0 PUBLICADA + MÍNIMA; 1.23.0 despublicada y ya no mínima** (única fila con publicada/mínima=true es 1.24.0). Los choferes por debajo de 1.24.0 quedan forzados a actualizar. Rollback si device-QA falla: marcar 1.23.0 publicada+mínima y desmarcar 1.24.0.
- **FASE 1 (U1+U8) — reconciliación optimista con el outbox (corrección de patrón):** helpers genéricos en `SyncService` (`kmPendiente`, `kmEfectivo`, `reportesSemanalesPendientes`), generaliza `combustible.maxKmPendiente`. `getVehiculoDetalle` devuelve **km efectivo = max(servidor, outbox pendiente)** → pre-uso/checklist/semanal/perfil/combustible/mantenimiento muestran el km nuevo sin esperar drain. U8: listado semanal marca "⏳ Enviando…"→"✓ Ya reportado" al instante, "Rehacer" en ambos, label "Ya reportado", refresca en `sync.changed()`; el handler invalida `reporte_semanal_semana` al drenar.
- **FASE 2 (U3+U4+U5):** `shared/util/scroll.ts` `resetScrollOnStep()` en los 8 wizards (scroll arriba en cada paso/sub-paso y en la vista de resultado). U4: veredicto grande ya existía; el fix real era el scroll. U5: addrow del parte (`parte.scss`) — era el gotcha global `.btn-ghost{width:100%}`; fix `width:auto`+`min-width:0`. `.adm-add` ya estaba bien.
- **FASE 3 (U9):** `reportar-multa` con autosave/borrador (persiste antes de abrir cámara/picker, restaura tras muerte de proceso MIUI, banner de recuperación), preview (miniatura `<img>` / ícono PDF), selector de vehículo (default = asignado) → `vehiculoId` real. Mismo autosave en `reportar-vehiculo` (accidente/daño) y `mantenimiento`.
- **FASE 4 (U6+U15):** combustible en 5 pasos hoja (km→galones/monto→estación→fotos→confirmar) con `KmInput` (ref = odómetro efectivo + mantenimiento en vivo) conservando "mayor que última echada". Mantenimiento: `KmInput` (bloquea km menor en vivo), **mín 1 foto**, miniaturas en resumen, autosave.
- **FASE 5 (U2+U7+U16):** pre-uso paso 2 sub-paginado (una sección/pregunta por pantalla, "Sección X de N"). Semanal: "Falla" exige comentario (cableado en `submit()`). U16: accidente/daño ya tipo-hoja; inventario ya usa patrón hoja. Etiquetas cortas vienen de V4/V3 (ya activas).
- **FASE 6 (U11+U12+U13+U14):** perfil del vehículo con alerta de mantenimiento (🔴 atrasado/🟠 cerca vs km efectivo) + último nivel de combustible + sección Multas (`FlotaReportesService.getMultasVehiculo`/`getUltimoNivelCombustible`). Asignar cruza `getMisAsignaciones` → "✓ Ya asignado" (no re-asignable) + accesos Reporte semanal/Rehacer y Pre-uso. `UbicacionLabelService` (match ≤200m obras/almacenes → Proyecto/Almacén, si no `GeocodingService.reverse()`, fallback "Capturada") cableado en recibir/devolver. Texto "**pasado con X km**" en checklist/preuso/km-input/PDF.
- **PENDIENTE device-QA (necesita teléfono/JWT real; APK 1.24.0 + PWA iOS):**
  - [ ] Recibir vehículo con km mayor OFFLINE → abrir pre-uso: muestra el km NUEVO (no el viejo).
  - [ ] Enviar semanal OFFLINE → listado marcado al instante ("Enviando…"→"Ya reportado" al drenar) + "Rehacer".
  - [ ] Scroll arriba en cada paso de todos los wizards; pre-uso BLOQUEADO pasa a vista de resultado clara.
  - [ ] Multa: adjuntar **archivo** en MIUI real sin crash; si se reinicia, recupera lo llenado; preview de foto/PDF; vehículo en el payload (verificar en SGC).
  - [ ] Combustible/mantenimiento con KmInput (km menor bloqueado en vivo); mantenimiento exige ≥1 foto y muestra miniaturas.
  - [ ] Pre-uso una pregunta por pantalla (textos V4); semanal "Falla" exige comentario (verificar comentario en SGC por ítem).
  - [ ] Perfil: alerta de mantenimiento (caso Lexus 49.8k vs 39k), último nivel, multas del vehículo.
  - [ ] Asignar marca los tuyos; ubicación legible en el resumen de recibir.
  - [ ] No regresión: outbox drena sin error, borradores, envíos, PDF/WhatsApp del pre-uso.
  - [x] ~~Marcar 1.24.0 publicada/mínima en SGC~~ — **hecho** (1.24.0 publicada+mínima; 1.23.0 despublicada). QA en device queda como validación post-publicación (rollback disponible si algo falla).
- **Autosave NO agregado** a combustible/crear-ruta/semanal (fuera del scope explícito de ronda 6). El lado server (U10 piso de consumo, U11-web, U14-server) es del repo SGC (PROMPT-13), no de esta app.

## Ronda 5 app — PROMPT-12 / Act.4 (2026-07-22) — v1.23.0 PUBLICADA + MÍNIMA
Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-4.md` (T19, T4-app, T18-app). `npm run build` VERDE. Commit `a52b215` en `main` (push hecho → deploy PWA). APK 1.23.0 firmado en bucket + `apk_url` + `version.json`, historial registrado (Y1, 4 cambios). **Publicada, NO forzada mínima** (sigue 1.22.1 como mínima). Migración `sql/2026-07-22-t19-equipos-obra-operatividad.sql` **aplicada en prod + espejada en repo SGC**.
- **T19c — resumen de wizards roto (causa raíz):** `.resumen` no era global; solo 4 wizards lo definían en su SCSS (encapsulado), los otros 6 usaban la clase sin regla → label `<span>` y valor `<b>` pegados ("Obraaasasa", "TipoIncidente de equipo"). **Fix:** una sola regla `.resumen` en `styles.scss` (patrón del parte + `word-break` para valores largos); eliminados los 4 duplicados locales (parte/checklist/preuso/mantenimiento). Los 6 rotos (incidente, crear-ruta, reporte-semanal, reportar-vehiculo, liberación, cl-detalle) ahora heredan la regla. 10 wizards idénticos.
- **T19a — selector de equipos de la obra:** RPC `sgc.equipos_de_obra(p_proyecto_id)` (security-definer; une `bitacora_equipos_alquilados` + `incidente_equipo_nombre` + `otros_valores` scoped por obra, dedupe por nombre normalizado). `BitacoraService.getEquiposDeObra` cachea offline por obra. Incidente de equipo: lista los equipos de la obra como botones (nombre canónico) + texto libre para nuevos. Paso 8 del parte usa las mismas sugerencias obra-scoped (fallback al global `getEquiposSugeridos`).
- **T19b — comentario de operatividad:** campo tras "¿Queda operativo?" — opcional en "Sí", **obligatorio** si quedó fuera de servicio (validación en el wizard). Nueva columna `sgc.bitacoras.incidente_equipo_operativo_comentario` + param `p_incidente_equipo_operativo_comentario` en `crear_bitacora_app` **y** `crear_entrada_bitacora` (aditivo, default null, sin overloads — verificado 1 función c/u). Va en payload, resumen del wizard y detalle del incidente en la app.
- **T4-app — estación de combustible:** selector desde `sgc.estaciones_combustible` (catálogo ya creado por el T4 web de hoy), cacheado offline con **fallback local** (Total Energies/Shell/Esso/Sunix/United/Texaco) para arranque en frío sin señal. **Total Energies preseleccionada**; "Otro" abre texto libre. Payload sigue enviando texto (RPC `registrar_combustible_app` sin cambios).
- **T18-app — badge de consumo: N/A.** La app no tiene listado de echadas por fila (solo contadores agregados `combustible_echadas` + banda Normal/Anormal en la confirmación). La condición del requerimiento ("si el listado muestra echadas") no se cumple; cuando exista un listado, enganchar `alerta_consumo` ahí.
- **1.23.0 PUBLICADA + MÍNIMA** (`publicada=true, minima=true`); 1.22.1 despublicada y ya no es mínima. Los choferes por debajo de 1.23.0 quedan forzados a actualizar. (QA en device recomendada igual — ver checklist abajo.)
- **PENDIENTE device-QA — CHECKLIST (necesita teléfono/JWT real; APK 1.23.0 + PWA):**
  - [ ] **Resúmenes legibles** ("Revisa y envía") — label gris a la izquierda, valor bold a la derecha, SIN pegarse. Probar: incidente, parte diario, recibir/devolver vehículo, pre-uso, mantenimiento, reporte semanal, crear ruta, accidente/daño, liberación, detalle de checklist.
  - [ ] **Incidente de equipo — selector**: en "¿Cuál equipo?" aparecen los equipos de la obra como botones; elegir uno fija el nombre; escribir uno nuevo también funciona (obra con historial de equipos).
  - [ ] **Incidente de equipo — comentario**: "Sí, sigue funcionando" → comentario opcional (puede enviarse vacío); "No, quedó fuera de servicio" → **bloquea** hasta escribir el comentario. El comentario sale en el resumen y en el detalle del incidente.
  - [ ] **Offline**: llenar incidente de equipo en **modo avión** → "Guardado · Sin señal"; al reconectar **drena solo**; en SGC web el incidente aparece con equipo + comentario.
  - [ ] **Combustible**: **Total Energies preseleccionada**; tocar otra estación cambia la selección; "Otro" abre texto libre; se envía y registra la echada (online y offline).
  - [ ] **No regresión**: incidente normal/accidente completo, bitácora (parte), combustible; el outbox drena sin dejar nada en error.
  - [x] ~~marcar 1.23.0 como MÍNIMA~~ — **hecho** (publicada + mínima).
- **PARIDAD WEB (regla #5, follow-up PROMPT-11-SGC):** la DB ya acepta el comentario de operatividad en ambos RPCs y `equipos_de_obra` está disponible; falta que el **web** capture el comentario en su form de incidente y lo muestre en el detalle. No es de este prompt (app).

## Ronda 4 app — PROMPT-10 flota (2026-07-21) — v1.22.1 PUBLICADA + MÍNIMA
- **1.22.1 (cierre de sub-puntos):** S20 (perfil del vehículo compara rendimiento real vs esperado km/gal, columna `rendimiento_esperado_km_gal`), S24(c) (el chofer registra desde "Mi actividad" una multa que le pusieron), S32 completo (entregas/recepciones + desglose pre-usos vs semanales, en "Mi actividad" y perfil del conductor). Nuevos reads en `FlotaReportesService`: getEntregasConductor, getChecklistsBreakdown.

Source: `CONTEXTO-ACTUALIZACION-3.md` (S15-S20, S26-S33 + §E S27-S31). Backend **PROMPT-9 verificado APLICADO en prod** (mis_rutas_hoy, crear_ruta_app c/ conductor+notificación, registrar_accidente/dano/multa_app, tablas vehiculo_accidentes/vehiculo_danos/conductor_multas, REPORTE-SEMANAL-V2 etiquetas cortas + copias físicas, registrar_checklist_vehiculo con fotos/firma/combustible, rendimiento_esperado_km_gal, v_conductor_stats, buckets vehiculos+flota-documentos upsert-safe) → **todo esto fue solo app**. `npm run build` VERDE. **NADA commiteado/publicado** (el prompt pidió no commit/push sin avisar).

- **FASE 0 bugs — VERIFICADO en equipo real (los grandes):**
  - **S30** (`app.config`): faltaba `CombustibleService` en el bootstrap eager → su handler no se registraba y la echada quedaba "En cola" para siempre. Agregado. + red de seguridad en `sync.process()` (si falta handler, cuenta intentos y tras el máximo lo marca error descartable) + botón Descartar para pendings >24h en `/pendientes`. ✅ verificado: el combustible atascado 23h drenó y mostró su error real; outbox quedó "Todo enviado".
  - **S27** (`checklist.html`): `$index` del `@for` de zonas eclipsaba al del daño → chips no seleccionables. Fix: alias `let di = $index` + usar `di`. Grep repo: era el único caso. ✅ verificado (Daño 1 Techo + Daño 2 Cristales independientes).
  - **S31**: `checklist.salir()`, `liberacion.back()`, `mantenimiento.salir()` → `location.back()` (replaceUrl dejaba hub duplicado). Auditados todos los `router.navigate` de salida.
  - **S28 GPS**: **causa raíz = permiso de ubicación DENEGADO** (ubicación del sistema ON, pero app `granted=false`), no bug de captura. Reescrito `permissions.getPosition`: watchPosition + getCurrentPosition en paralelo + `maximumAge:60s` + timeout 25s + detección de "GPS apagado"; captura proactiva desde el paso 1. Permiso ya concedido por adb. **Falta el visto en device** (recibir → paso 6 → "📍 Capturada"). Memoria: [[gps-permission-denied-root-cause]].
  - **S29** (`checklist`): `vehiculos.estaActivo(id)` pre-check al abrir y antes de encolar recibir; si no existe/inactivo → aviso + refresca pool + vuelve al hub. + invalida pool al enviar.
- **FASE 1 (S15/S26b):** hub de transporte = grid de `app-big-button` gated por rol (`ctx.esFlotaElevado()`); cuadro "Registrar combustible" a un tap (ruta sin vehículo → elige del pool). Helper `esFlotaElevado`/`hasRol` en UserContextService.
- **FASE 2 (S17/S18/S19/S26a):** componente compartido **`app-km-input`** (último km + menor-en-vivo + estado de mantenimiento en vivo) usado en semanal + recibir/devolver (pre-uso ya lo tenía inline). Reporte semanal reescrito **tipo hoja** (una sección por pantalla) + **fotos guiadas + nivel de combustible + firma** (RPC ya lo soporta; servicio ampliado a subir fotos/firma) + aviso de mantenimiento en el resumen. S18 (copias físicas) sale del seed V2.
- **FASE 3 (S16):** `crearRuta` ahora manda `conductor_id` (el jefe asigna → dispara la notificación del trigger). `crear-ruta` gated a elevados (chofer redirigido a Conduces). Chofer ve rutas asignadas vía `mis_rutas_hoy` (ya existía en Conduces). **crear-ruta convertido a wizard tipo hoja de 6 pantallas** (vehículo → conductor → origen → destino → detalles → resumen).
- **FASE 4 (S22/S24):** `FlotaReportesService` (accidente/daño/multa por outbox, handlers eager). Página `reportar-vehiculo` (wizard: accidente [fase→qué pasó→lesionados/tercero→acta AMET→resumen] o daño [zona chips→foto→resumen]) desde el perfil del vehículo. Página `reportar-multa` desde el perfil del conductor (elevados). Nota: el accidente guarda el acta AMET (el RPC no tiene array de fotos generales).
- **FASE 5 (S32/S33):** S33 avisos de flota rediseñados (críticos arriba, iconos por tipo, filtro Todos/Críticos/Míos, marca CRÍTICO; mantiene Ver/Atender). S32: perfil del conductor Y **"Mi actividad"** (chofer) muestran **rutas asignadas, accidentes y multas** (drill-down a Conduces) además de los checklists/echadas existentes.
- **RELEASE:** commiteado + pusheado a `main`; APK 1.22.1 firmado en bucket, historial registrado (Y1), **PUBLICADA + MÍNIMA** (1.22.0/1.21.1 despublicadas). Todos los S15-S20, S22, S24, S26-S33 del prompt están cubiertos en el app.
- **PENDIENTE (único):** device-QA de las features de flota (hub, semanal, rutas, accidente/daño/multa, avisos, actividad) + el visto de GPS ("📍 Capturada" ya con permiso concedido). Las vistas WEB de SGC para accidentes/multas/dashboards (S20 web, S23, S25) son de PROMPT-9-SGC (otro repo), fuera del app.


## v1.21.1 PUBLICADA + MÍNIMA (2026-07-21) — arreglo arranque OFFLINE en frío
- **Problema (hallazgo de la ronda 4):** abrir la app SIN internet en frío mostraba **"Sin módulos asignados"** (y sin nombre). Causa doble: (1) `session.ensureProfile()` usaba `supabase.auth.getUser()` que SIEMPRE hace red → null offline; (2) `UserContextService.loadProfile()` no cacheaba el perfil en disco y ponía `null` al fallar.
- **Fix (cache-then-network / stale-while-revalidate — el patrón que ya usa `CatalogService`, confirmado con research: Supabase `getSession` lee storage local y funciona offline, `getUser` siempre hace red):**
  - `ensureProfile()` toma el `userId` de `getSession()` (offline-safe) en vez de `getUser()`. Datos siguen bajo RLS con el token real.
  - `loadProfile()` hidrata al instante el perfil cacheado y revalida vía `CatalogService.refresh` (escribe caché con señal, conserva la copia si falla). Solo `null` si nunca hubo caché. `clear()` borra la caché del perfil al cerrar sesión (clave `perfil_{userId}`).
- **VERIFICADO en equipo real:** arranque OFFLINE en frío (force-stop + modo avión, `ping` inalcanzable, wifi/data off) ahora muestra **nombre + los 5 módulos**; al reconectar revalida solo. Commit `938e14d`. APK 1.21.1 en bucket, **PUBLICADA + MÍNIMA** (1.21.0 despublicada), historial registrado (Y1).
- Nota: los badges (p. ej. Transporte 42) siguen siendo online-only (se ocultan offline, esperado).

## Ronda 4 app (2026-07-21) — PROMPT-10 FASES 1–5 — v1.21.0 PUBLICADA + MÍNIMA, verificado en equipo real
- **PUBLICADA + MÍNIMA: 1.21.0** (`app_versiones` movil → publicada/minima true; 1.20.3 despublicada). APK firmado (cert prod `3c5316d8…df5065`) en bucket + `apk_url` + `version.json`. Commit `a26df2d` en `main` (push hecho → deploy PWA). Historial registrado (Y1) con 7 cambios estructurados.
- **VERIFICADO EN EQUIPO REAL (Xiaomi/MIUI vía adb) + BD:**
  - Bitácora nueva ONLINE: 10 pasos, sujeto arriba, actividades ordenadas, multi-bloque, ≥2 fotos, equipos retirar/dañado, resumen por bloque → enviada. BD confirmó `bloque_entrepiso` + `bitacora_actividades.bloque` por línea.
  - Bitácora OFFLINE (modo avión mid-wizard): "Guardado · Sin señal", encolada en outbox, y al reconectar **drenó sola** al servidor (BD confirmó bloque). Offline-first ✓.
  - Incidente tipo hoja (7 pasos): tipo **incidente_equipo**, preguntas de equipo, sucesos del catálogo por tipo → enviado. BD confirmó `incidente_tipo=incidente_equipo`, `incidente_suceso`, `incidente_equipo_nombre/alquilado/operativo`.
  - S14: cl-detalle muestra review read-only completa (puntos por sección con checks, plano+fotos, firmas con imagen + verdes) y "Firmar como {rol}" al final.
- **Observación (arranque offline en frío "Sin módulos asignados"):** ✅ **RESUELTO en v1.21.1** (perfil/módulos cacheados en disco — ver entrada de 1.21.1 arriba).
- **Detalle web SGC (hard rule #5): ✅ YA HECHO** — el detalle de bitácora en SGC (`pages/bitacora/historial`, drawer) ya agrupa actividades por bloque (`actividadesAgrupadas()` + subtítulo por bloque), muestra los flags de equipo (Para retirar / Dañado + detalle) y los campos de incidente de equipo/suceso. Implementado en **web 1.18.0** (commit `99e03e2`, Act.3 S4/S7/S12/S13/S14), ya en `origin/main` → desplegado. Modelo/servicio/HTML completos.
Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-3.md` (S1–S14). **Backend PROMPT-7/Act.3 verificado APLICADO en prod** (RPC `crear_bitacora_app` con `bloque`/equipos-flags/incidente-suceso-equipo, `catalogo_ordenado`, sucesos en `bitacora_catalogos`, min-fotos server-side, `incidente_equipo` en el CHECK). Todo esto fue **solo trabajo de app**. `npm run build` VERDE. **NO commiteado, NO release aún** (esperando OK de Xavier).
- **S2** (`bitacora.service.getCatalogoOrdenado`): consume `catalogo_ordenado(proyectoId)` → estructuras/actividades ordenadas por ejecución con las ~3 más usadas de la obra primero (★). Cacheado offline por obra; fallback a `getCatalogos()` plano.
- **S3/S4** (parte wizard, ahora **10 pasos**): paso 5 "¿qué se hizo hoy?" es sub-máquina `sujeto → actividades → ¿otro bloque?`. El bloque/piso/edificio se elige ARRIBA; cada actividad lleva su `bloque`; multi-bloque sin rehacer; resumen agrupa por bloque. Campo de bloque del viejo paso 9 eliminado (se manda `bloque_entrepiso` = resumen de bloques por retrocompat).
- **S8**: paso 9 = ingeniero + hora fin + comentario; paso 10 = resumen NO editable agrupado.
- **S5** (`borrador.service.migrateLegacyParte` + clave por instancia `parte_diario:{uuid}`): multi-borrador; `en-proceso` lista todos y retoma por `?borrador=<clave>`; migra el borrador legacy sin perderlo.
- **S6**: min 2 fotos en el parte (gate en app + espejo en RPC). Incidente min 1.
- **S7** (paso 8, sub-máquina `uso → retirar → dañados`): flags `para_retirar`/`danado`/`dano_detalle` por equipo; el server avisa al transportista.
- **S11/S12/S13** (`incidente` reescrito a wizard tipo hoja, 7 pasos): obra → tipo (incidente/accidente/**incidente_equipo**) → preguntas del tipo → ¿qué pasó? (sucesos del catálogo `suceso_*` + Otro) → fotos(≥1)+voz → acciones → resumen. Autosave + salir del header + step-bar/wizard-footer. Nuevos campos incidente en payload/RPC.
- **S14** (`cl-detalle`): antes de firmar se muestra **revisión read-only completa** (ítems cumple/no cumple + comentarios agrupados por sección, fotos+plano con URLs firmadas, observaciones, firmas puestas con imagen + checks verdes) y el botón "Firmar como {rol}". `getCl()` ampliado (items/fotos/plano/firma_path + signed URLs); modelo `ClRegistroDetalle` extendido.
- **App detalle de bitácora** (`bitacora/detalle`): actividades agrupadas por bloque + flags de equipo retirar/dañado + campos de incidente (suceso/equipo).
- (Detalle por-S de la implementación; el estado/QA/release está resumido arriba.)


## ✅ RESUELTO Y VERIFICADO — subida de documentos cédula/licencia (2026-07-21, v1.20.3)
- **CAUSA RAÍZ (confirmada):** la app sube las fotos con `upsert: true` (`sync.service.ts` `uploadPhotos`). Al **reintentar** un envío cuyo objeto **ya existía** en Storage (la foto se subió en la captura original y el envío quedó atascado), Storage ejecuta un **UPDATE** sobre `storage.objects`. TODOS los buckets de campo (`vehiculos`, `conduces`, `inventario`, `obra`, `reportes`) tienen su policy UPDATE por esto — pero `flota-documentos` (creado por SGC web) tenía solo INSERT/SELECT/DELETE. **Sin policy UPDATE → "new row violates row-level security policy"** en el re-upload (NO era la tabla ni el INSERT de storage).
- **FIX (server-side, no requiere nueva versión de app):** 3 migraciones aplicadas a prod + commiteadas en repo SGC (commit `cdfbb96`):
  1. `2026-07-21-registrar-documento-app.sql` — RPC `security definer` `sgc.registrar_documento_app` (insert idempotente en `sgc.documentos` como owner, exige auth + flota/admin). Alinea el write con la regla madre.
  2. `2026-07-21-flota-documentos-rls-align.sql` — INSERT de storage/tabla por `bucket_id` para `authenticated`.
  3. `2026-07-21-flota-documentos-storage-update-policy.sql` — **la que cerró el bug**: policy UPDATE en `flota-documentos` por `bucket_id`.
- **App (v1.20.3, PUBLICADA + MÍNIMA):** `documentos.service.ts` inserta vía el RPC (antes insertaba directo en la tabla); `DocumentosService` en `provideAppInitializer` (handler registrado al boot). Commit `20a0700`.
- **VERIFICADO EN EQUIPO REAL:** tras "Reintentar todos" en 1.20.3 con las policies aplicadas, un doc `cedula` se insertó en `sgc.documentos` (`created_at` en el instante del reintento) y las 3 tarjetas de "Documento (cédula/licencia)" **desaparecieron** de Pendientes. ✅
- **Lo que queda en rojo en Pendientes son datos QA irreparables** (Entrega/recepción + Pre-uso → "Vehículo no encontrado o inactivo": el vehículo de esas capturas de prueba fue borrado/desactivado) → **Descartar**.

## SEGUIMIENTO subida de documentos (2026-07-21) — opción A aplicada, pero NO resuelve
- **Opción A APLICADA** (SGC): `sql/2026-07-21-flota-documentos-rls-align.sql` — `documentos_ins` → `with check(true)` y `flota_docs_ins` (storage) → solo `bucket_id`, ambas `to authenticated`, igual que los otros buckets de campo. Verificado en la BD.
- **Pero la subida de documentos SIGUE fallando "new row violates row-level security policy"** aun con la RLS abierta → la petición NO entra como `authenticated`. Contradicción clave: las LECTURAS que requieren sesión SÍ funcionan (badge de `avisos_flota`=41 con `es_flota_elevado()`, y lectura de `documentos` con is_admin/flota) → la sesión está VIVA para lecturas. Y las subidas de foto de otros features (pre-uso/checklist/vehículo) llegan al RPC (uploadPhotos OK vía upsert). Solo la subida de DOCUMENTO (path nuevo → INSERT en storage.objects del bucket flota-documentos + insert directo en tabla) falla. Es el ÚNICO write que NO usa un RPC `security definer` (viola la regla madre del proyecto).
- **CAUSA probable:** la petición de subida a Storage (o el insert directo) del path de documentos sale sin el JWT de usuario (rol `anon`) pese a que el cliente tiene sesión — posible issue del storage-client de supabase-js con el storage adapter async, o timing. Necesita **build de debug + chrome://inspect / logs de red** para verlo (imposible con el APK release + USB que se cae + biometría en cada relaunch).
- **FIX arquitectónico recomendado (próxima ronda):** enrutar la subida de documento por un RPC `security definer` `sgc.registrar_documento_app(...)` (como TODOS los demás writes) para el insert en `documentos`, y confirmar/ajustar la subida a Storage. Eso lo hace robusto sin depender de la RLS/adjunto-de-sesión. Mientras: **Descartar** los documentos viejos atascados (los archivos ya están en Storage) y probar una subida NUEVA tras **cerrar sesión y volver a entrar** (sesión fresca).

## v1.20.2 PUBLICADA + MÍNIMA (2026-07-21) — envíos atascados, verificado en equipo real
- **PUBLICADA + MÍNIMA: 1.20.2** (`version_publicada(movil)` → 1.20.2/1.20.2). APK firmado en bucket. Commits `77168bd` + release.
- **RESUELTO Y VERIFICADO en APK real:**
  1. **Backfill `capturado_en` (1.20.0):** los envíos que decían "function not found" (pre-uso, checklist, entrega/recepción, liberación, reporte) **ahora llegan al servidor** y devuelven su error real. Confirmado: pre-uso pasó de "function not found" a "Vehículo no encontrado o inactivo".
  2. **Handler de documentos al arrancar (1.20.2):** `DocumentosService` faltaba en `provideAppInitializer` → su handler `documento_upload` no se registraba en arranques directos a /pendientes → los documentos quedaban **invisibles "En cola" para siempre** (process() los saltaba por falta de handler). Ahora se registra al boot; confirmado que los docs pasan de invisibles a **error visible con Descartar**.
  3. **retryErrored resetea pending+error (1.20.1)** y **timeout de 90s por envío** (evita que un envío colgado congele la cola).
- **Los que quedan en rojo tras "Reintentar todos" son legítimamente NO enviables** (datos de prueba): vehículos borrados/desactivados → "Vehículo no encontrado"; salida con stock 0 → "Stock insuficiente". Solución: **Descartar**.
- **ABIERTO — subida de documentos (cédula/licencia) → "new row violates row-level security policy":** causa pinpointeada = el bucket `flota-documentos` (y la tabla `sgc.documentos`) exigen en su policy INSERT `is_admin() OR tiene_modulo('flota')`, mientras que los OTROS buckets de campo (`vehiculos`, `conduces`, `inventario`, `reportes`, `obra` → policy `csd_field_buckets_insert`, `obra_bucket_insert`, etc.) **NO exigen auth** (solo `bucket_id`). Por eso las fotos de vehículo/inventario suben y las de documento no: la subida del drone/drain no satisface `is_admin OR flota` para esas peticiones. `is_admin()`/`tiene_modulo('flota')` con el uid admin de Xaviel dan TRUE (verificado), así que la petición de Storage sale sin `auth.uid()` efectivo para esa comprobación. **No pude cerrar el root-cause exacto** (necesita chrome://inspect / logs de red en vivo; el teléfono se desconecta seguido y pide huella en cada relaunch). **DOS opciones de fix (decisión de Xaviel):** (a) alinear la RLS de `flota-documentos` + `sgc.documentos` INSERT a lo mismo que los otros buckets de campo (permitir a `authenticated` sin el gate `flota`, o bucket-only) — cambio en SGC, afloja seguridad pero es consistente con el resto; (b) mover la subida a un RPC `security definer` + investigar por qué la sesión no se adjunta a la petición de Storage con un build de debug. Workaround inmediato: **Descartar** esos documentos viejos (los archivos ya están en Storage desde el día anterior); re-subir desde el perfil del conductor con sesión fresca.

## v1.20.1 PUBLICADA + MÍNIMA (2026-07-20/21) — envíos atascados: verificado en equipo real
- **PUBLICADA + MÍNIMA: 1.20.1** (`version_publicada(movil)` → 1.20.1/1.20.1). Commits `1da85e2` + release. APK firmado en bucket.
- **VERIFICADO en APK real (Xiaomi MIUI):** el fix de v1.20.0 (backfill de `capturado_en` en `SyncService.process`) FUNCIONA — los envíos que decían "function not found" ahora **llegan al servidor** y devuelven su error REAL: pre-uso/mantenimiento/salida daban "Vehículo no encontrado o inactivo" / "Stock insuficiente" (datos de prueba con vehículos borrados / stock 0 → esos se **Descartan**, no hay forma de enviarlos). Combustible quedó "En cola para enviar" (válido).
- **v1.20.1 añade:** `retryErrored()` ahora también resetea items 'pending'/'syncing' (antes solo 'error') → "Reintentar todos" fuerza CADA envío. Y `process()` envuelve subida+handler en **timeout de 90s** para que un envío colgado no deje `draining=true` y congele la cola.
- **ABIERTO — documentos cédula/licencia (de mis pruebas de P3, no del usuario):** varios quedan "En cola para enviar" y **no llegaron a insertarse** en `sgc.documentos` (los archivos SÍ están en Storage desde hace horas). "Último aviso: new row violates row-level security policy". Bajo sesión admin de Xaviel la RLS `is_admin() OR tiene_modulo('flota')` debería pasar → sospecha: se encolaron bajo una sesión sin `auth.uid()` válido, o el drain se trababa (mitigado con el timeout de 1.20.1). **Falta device-QA con logs** (el teléfono se desconecta seguido + pide huella en cada relaunch). Workaround para el usuario: **Descartar** esos documentos viejos (los archivos ya están en Storage; re-subir desde el perfil del conductor funciona en 1.20.x con el fix DO NOTHING). Si reaparece con documentos NUEVOS, es bug real de RLS/sesión a depurar.

## v1.20.0 PUBLICADA + MÍNIMA (2026-07-20) — fix de envíos atascados + firmar CL desde aviso
- **PUBLICADA + MÍNIMA FORZADA: 1.20.0** (`version_publicada(movil)` → 1.20.0/1.20.0). 1.19.0 despublicada. APK firmado en bucket, `apk_url` OK, historial registrado. Commits `8e71f60` (firmar CL) + `79f29cf` (fix sync) en `main`.
- **FIX raíz de "reintentar y no se envían":** ítems encolados por versiones previas (liberación, checklist/reporte, recepción de vehículo) no traían `capturado_en` en el payload y varios RPC lo EXIGEN → fallaban con "function not found" y el reintento repetía el fallo. `SyncService.process()` ahora **rellena `capturado_en` desde la fila del outbox** (que siempre lo tiene) antes de llamar al handler → esos envíos por fin se mandan. `retry()`/`retryErrored()` limpian `permanente`/`error_kind` (reintento explícito re-evalúa; sin bucle automático porque `drain()` no reintenta ops en error). Botón "Reintentar todos" en `/pendientes`. **Los realmente irreparables** (p. ej. vehículo borrado → "Vehículo no encontrado") vuelven a error en 1 intento y se **Descartan**.
- **Firmar CL desde el aviso (Q5 3b):** bandeja `/bitacora/cl` + detalle/firma `/bitacora/cl/:id` (ver detalle abajo). Ya en el APK.
- **Instrucción para el usuario en el teléfono:** actualizar a 1.20.0 (gate) → abrir la barra de estado → "Pendientes de envío" → "Reintentar todos". Lo que quede en error es porque su vehículo/referencia fue borrado → "Descartar".
- **PENDIENTE device-QA:** confirmar que los atascados se envían tras 1.20.0.

## Ronda 2 app (2026-07-20) — v1.19.0 PUBLICADA + MÍNIMA FORZADA (Q2, Q4–Q9)
Source: `C:\developer\improvements\imp 20072026\CONTEXTO-ACTUALIZACION-1.md` (Q1–Q9) — PROMPT-4 (app). SGC (PROMPT-3) ya desplegado: trigger `trg_cl_firmado` solo exige residente+responsable, columnas `cl_registro_firmas.metodo` y `bitacora_actividades.unidad`, RPCs `notificar`/`notificar_modulo`. `npm run build` verde por fase.
- **PUBLICADA + MÍNIMA FORZADA: 1.19.0** (`version_publicada(movil)` → 1.19.0/1.19.0, code 1019000). 1.18.0 despublicada. APK firmado (cert prod `3c5316d8…df5065`) en bucket, `apk_url` OK, historial registrado. Commit `c3d43e6` (feat) en `main` (deploy PWA). ⚠️ **Fix de release:** `registrar_version` ahora tiene 2 overloads en la BD (5 y 6 args con `p_url`) → PGRST203 ambiguo; `release-apk.mjs` ahora manda `p_url` para desambiguar a la de 6 args.
- **Q4** liberación: cámara directa + grid de miniaturas (✓/✗+desc+quitar), multi-foto, "Repetir" junto a "Agregar" (reusa `[foto]` de P10).
- **Q7** `wizard-exit` (← Salir) en liberación/pre-uso/checklist/mantenimiento/combustible (las que faltaban); confirm con borrador (autosave) o "sin guardar"; back físico intacto. entrada/salida/conductor-form/crear-ruta ya tenían.
- **Q8** labels "Parte diario" → "Bitácora del día" (en-proceso + etiqueta borrador). Sin tocar BD/rutas.
- **Q6** selector de unidad en "¿Qué se hizo hoy?" (catálogo `unidades` offline), preselección desde la partida, viaja en `p_actividades`, visible en detalle.
- **Q9** filtro por obra + conteo en "Mis bitácoras".
- **Q5** cliente/MIVHED opcionales, checklist visual verde, guardar incompleto, "Solicitar firma" (`notificar_modulo`, online), firma del cliente por foto (`metodo='foto'`).
- **Q2** avisos de flota → botón "Ver vehículo/reporte" (navega al ítem, `?item=`); badges de pendientes por módulo en home (`avisos_flota` pendiente, `salidas_inventario` despachado) — nuevo `BadgesService`, `big-button` ya tenía input `[badge]`.
- **Q5 punto 3b — HECHO (en `main`, aún NO en el APK publicado 1.19.0):** nueva pantalla de detalle+firma del CL (`pages/bitacora/cl-detalle`, ruta `/bitacora/cl/:id`) + bandeja "Liberaciones por firmar" (`pages/bitacora/cl-firmas`, ruta `/bitacora/cl`, botón en el hub de bitácora). Carga el CL del servidor (`getCl`), muestra el checklist de firmas (verde/gris), y firma el rol propio por trazo o (cliente) por foto vía `firmarCl` (sube al bucket `obra` + INSERT en `cl_registro_firmas`; el trigger pasa a `firmado` con Residente+Responsable). Online-only. El aviso "Solicitar firma" ya apunta a `/bitacora/cl/{id}`. **Para que llegue al APK Android hace falta bump + release** (pendiente de tu OK); el push a `main` ya lo lleva a la PWA (iOS).
- **PENDIENTE device-QA:** liberación 3+ fotos/grid, salir de cualquier wizard, firmas verde + foto del cliente + solicitar, unidad en trabajo, filtro por obra, avisos→ítem, badges home.

## Ronda QA app (2026-07-20) — v1.18.0 PUBLICADA + MÍNIMA FORZADA (P1–P13 + fixes de QA en equipo real)
Source: `C:\developer\improvements\imp 20072026\CONTEXTO.md` (P1–P13) + `apuntes de reunion.md`. PROMPT-2 (app). **`npm run build` verde en cada fase.**
- **PUBLICADA + MÍNIMA FORZADA: 1.18.0** (gate BLOQUEANTE — todos deben actualizar). `version_publicada(movil)` → publicada 1.18.0 / minima 1.18.0 (code 1018000). 1.16.0 y 1.17.0 despublicadas y `minima=false`. APK firmado (cert prod `3c5316d8…df5065`) en el bucket (`csd-app-1.18.0.apk` + latest + version.json), `apk_url` OK, historial `app_versiones` (movil) registrado. `MIN_VERSION` de `release-apk.mjs` = 1.18.0. Commits en `main`: `d725b9e` (P1–P13) · `66a26f5` · `bd60a2a` (1.17 min) · `6c64914` (fixes QA 1.18). Push a `main` dispara deploy PWA (iOS).

### QA en equipo real (Xiaomi M2101K6G / MIUI, vía adb) — VERIFICADO
- **FASE 0 permisos:** manifest mergeado del APK trae RECORD_AUDIO + ACCESS_FINE/COARSE_LOCATION (verificado con `dumpsys package`). App arranca en MIUI sin crash. (Falta el gesto físico de grabar voz / GPS, pero el bloqueo de raíz —permiso no declarado— está resuelto.)
- **FASE 1 /pendientes:** VERIFICADO en pantalla real — errores legibles, Reintentar por item, Ver detalle, y **Descartar con confirmación (borra el item)**. La sync-bar abre la pantalla ("toca para revisar").
- **Diagnóstico de los atascados (eran 7):** (1) Liberación de checklist y (2) Reporte semanal → `registrar_cl_app`/`registrar_checklist_vehiculo` "function not found": payloads viejos SIN `p_capturado_en` (los RPC lo exigen, sin default); la app ACTUAL sí lo envía → capturas nuevas OK, los viejos se descartan. (3–6) 4× Documento cédula/licencia → ver bug abajo. (7) Entrega de vehículo → "Vehículo no encontrado o inactivo" (P0001 legible; el vehículo fue borrado/desactivado → descartar).

### DOS BUGS DE PRODUCCIÓN encontrados y arreglados en 1.18.0
- **P3 (subida de documentos) root cause:** el rol `authenticated` tiene INSERT en `sgc.documentos` pero **NO UPDATE**; el handler hacía `.upsert(onConflict:'id')` = INSERT…ON CONFLICT DO UPDATE (exige UPDATE) → **42501** → la foto SÍ subía a Storage pero la fila de `sgc.documentos` nunca se creaba ⇒ "sin documentos" (la queja original). **Fix (app):** `ignoreDuplicates:true` (DO NOTHING, idempotente por client-uuid, solo requiere INSERT). *(Además vi "new row violates RLS" en intentos viejos = drenados sin sesión válida / `auth.uid()` null; con sesión admin/flota la RLS `is_admin() OR tiene_modulo('flota')` pasa — chofer_transportista SÍ tiene módulo flota.)*
- **P5 (clasificación de errores) root cause:** `throwSyncError` marcaba 401 como transitorio incluso con código permanente detrás (42501 "permission denied"/RLS llega como 401; PGRST202 "function not found" no se clasificaba) ⇒ **bucle infinito sin diagnóstico**. **Fix:** el código permanente (SQLSTATE 42/23/22/P0001 + PGRST202/203/204/205 + "schema cache") MANDA sobre la heurística 401; nuevo kind `incompatible`; errores de Storage ahora clasificados; y `/pendientes` muestra el motivo del último fallo aun en items que reintentan.
- ⚠️ **Recomendado (SGC, opcional):** el `GRANT UPDATE ON sgc.documentos TO authenticated` cerraría el hueco original de forma canónica (regla #3 de grants), aunque el fix de app ya lo resuelve sin tocar la BD. Y considerar refrescar el token antes de drenar el outbox (evita el "violates RLS" por `auth.uid()` null).
- Validación nativa: `compileDebugJavaWithJavac` OK y **manifest mergeado con RECORD_AUDIO + ACCESS_FINE/COARSE_LOCATION verificado**. APK release firmado con el cert prod correcto.

**FASE 0 — Permisos Android (P1 mic + P2 GPS) [CRÍTICO, causa raíz corregida]**
- `android/app/src/main/AndroidManifest.xml`: **+RECORD_AUDIO, +MODIFY_AUDIO_SETTINGS, +ACCESS_FINE_LOCATION, +ACCESS_COARSE_LOCATION** (+ uses-feature mic/gps required=false). Verificado en el **manifest mergeado** del build debug. Esto destraba la nota de voz del incidente y el GPS (crear ruta / recibir vehículo). El WebView de Capacitor concede mic/cámara vía `onPermissionRequest` una vez declarado el permiso del SO — no hizo falta código nativo extra para el mic.
- Nuevo plugin nativo `AppSettingsPlugin.java` (registrado en `MainActivity`) → método `open()` deep-link a Ajustes de la app (para permiso "denegado permanente"). Espeja `ApkInstallerPlugin`.
- Nuevo `core/services/permissions.service.ts`: punto único de permisos (ubicación check/request/getPosition con errores clasificados: denied / denied-permanent / timeout / unavailable; micrófono vía getUserMedia; `openAppSettings()`). Usa @capacitor/geolocation nativo o la Geolocation API en PWA.
- Onboarding: se añadió un paso "Permite tu ubicación" al tour existente (`shared/components/onboarding`) — se pide al primer arranque tras login. El mic se pide on-demand al grabar.
- On-demand con mensaje claro + botón "Abrir ajustes" (toast con acción, nuevo `ToastService.withAction`) en: `location-picker`, `crear-ruta` (`usarMiUbicacion`+`captureGps`), `checklist` (`captureGps`/`reintentarGps`, GPS best-effort), `voice-recorder` (clasifica NotAllowed/NotFound/Security).
- **PENDIENTE device-QA (tu hardware):** grabar+ESCUCHAR nota de voz en incidente (reproducción ya existía en `bitacora/detalle`); "Usar mi ubicación actual" en crear ruta; GPS automático en recibir vehículo; que iOS PWA no se rompa.

**FASE 1 — Outbox con diagnóstico (P5) [CRÍTICO]**
- Nueva pantalla **`/pendientes`** ("Pendientes de envío") — se abre al tocar la `sync-bar` (ya no reintenta a ciegas; texto de error ahora "toca para revisar"). Lista cada item: tipo de op en español + ícono, fecha relativa, estado (badge), nº fotos, intentos, y **error traducido** por familia (permiso/referencia/no-encontrado/conflicto/datos/foto/red/validación→mensaje del RPC). Acciones por item: **Reintentar**, **Ver detalle** (error crudo), y **Descartar** (con confirmación) solo en errores permanentes.
- `sync.service.ts`: `PermanentSyncError` ahora lleva `kind`; `throwSyncError` clasifica por SQLSTATE/HTTP. `handleFailure` guarda `error_kind`+`permanente`. **`uploadPhotos` ya NO hace `continue` silencioso** si faltan los bytes de una foto → lanza error permanente "foto perdida" (rompe el bucle infinito). `retryErrored()` reencola **solo transitorios**; permanentes requieren acción del usuario. Nuevos: `discard(id)` (borra op+fotos, conserva registro local en 'error'), `listOutbox()`, señal `changed` para refresco reactivo.
- **PENDIENTE:** diagnosticar los **4 items atascados** del teléfono de Xaviel — ahora se leen abriendo `/pendientes` (dime el error de cada uno).

**FASE 2 — UX (P9 scroll · P10 fotos wizard · P11 inputs)**
- P9: `withInMemoryScrolling({scrollPositionRestoration:'top', anchorScrolling})` en `app.config` + reset de `.screen`/`.screen__body` en cada `NavigationEnd` (doble rAF) en `app.ts` (Angular no restaura divs internos). Toda pantalla abre arriba.
- P10: `photo-slot` gana input `[foto]` para **rehidratar** la miniatura (los wizards con `@if(step===N)` recreaban el slot y la perdían). Regla de object-URL: con `[foto]` el padre es dueño y el slot NO revoca en destroy. Pasado en TODOS los wizards: pre-uso (fotos guiadas + foto de falla por ítem), checklist recibir/devolver (fotos + daños), mantenimiento, combustible, liberación, entrada.
- P11: regla global `.field` extendida a `input/textarea/select` (textarea con padding vertical + min-height); migrado el textarea de admin/reportes y limpiados los estilos duplicados de `reportar__area` y `rep-card__area`.

**FASE 3 — Documentos de conductor subibles desde el perfil (P3)**
- `perfil-conductor` ahora permite **subir/reemplazar** cédula/licencia (DocSlot editable + outbox existente `documento_upload`), gated a admin/flota o el propio conductor. Badge "⏳ Pendiente de subir" para encolados (vía `documentos.tiposEnCola`); refresco reactivo al drenar (`sync.changed`). Texto vacío de `doc-slot.html` corregido ("Se sube desde la web" → "Sin documento.").

**FASE 4 — Recibir vehículo sale del listado (P4)**
- `transporte.ts`: reconciliación local — `vehiculos.entregasRecepcionPendientes()` lee el outbox y los vehículos con recepción encolada se marcan **"🔄 Enviando recepción…"** (botón Recibir oculto). Recarga en cada `NavigationEnd`/entrada Y tras cada drain (`effect` sobre `sync.changed`), así desaparece cuando el servidor confirma.

**FASE 5 — Comentario obligatorio en crítico del pre-uso (P6)**
- `preuso.canAdvance()` bloquea avanzar si un ítem con hallazgo **crítico** (respuesta "no") no tiene comentario (señala cuál). Campo marcado obligatorio en la UI. Resumen y **PDF** muestran "Qué pasó:" prominente (rojo) en críticos, no solo la categoría. (Paridad web ya aplicada por PROMPT-1.)

**FASE 6 — Generar PIN de conductor desde la app (P8)**
- Nuevo modal `shared/components/generar-acceso` (PIN 6 dígitos, valida `/^\d{6}$/`, online-only con mensaje offline) → llama la MISMA edge `conductor-crear-acceso` (nuevo `ConductoresService.generarAccesoConductor`). En el **alta** (`conductor-form`): paso opcional tras crear. En el **perfil**: botón "Generar acceso / Restablecer PIN" (según `usuario_id`). Muestra la cédula como usuario.

**FASE 7 — Reflejar km actualizado (P7 app) [depende de PROMPT-1 SGC]**
- `CatalogService.invalidate`/`invalidatePrefix` nuevos. Los handlers de `checklist_preuso`, `combustible`, `mantenimiento`, `vehiculo_entrega` invalidan `veh_detalle:{id}`, `pendientes_transporte`, `flota_vehiculos` tras sincronizar. `perfil-vehiculo` refresca stats en silencio al drenar. **Requiere que los RPCs del SGC ya empujen `vehiculos.kilometraje` (PROMPT-1 FASE 1).**

**FASE 8 — Devolución de obra con traspaso (P12 app) [depende de PROMPT-1 SGC]**
- `entrada.ts`: motivo "Devolución de obra" → selector de **obra** (`getObrasConBodega`, offline) + checkbox "Registrar salida del almacén de la obra" (solo si la obra tiene bodega). Nueva op outbox `inv_devolucion_obra` → llama el RPC `registrar_devolucion_obra` (existe en `sql/2026-07-20-p12-devolucion-obra.sql`). Rechazo por stock insuficiente = error permanente legible (FASE 1). Invalida caches de existencias al sincronizar.
- **⚠️ OJO idempotencia:** `registrar_devolucion_obra` NO recibe client-uuid, así que un reintento del outbox tras un ack perdido podría duplicar el movimiento. Recomiendo añadirle un `p_client_uuid` (aditivo) en SGC para cerrar ese hueco. Marcado para confirmar.

**FASE 9 — Dashboards de auditoría en la app (P13)**
- `admin/auditoria`: toggle **Panel / Filas**. Panel = KPI cards (acciones/usuarios/áreas/días) + gráficos de **barras CSS** (usuarios top, por acción, por área, por día, por hora) con selector de período (7/30/90/todo), consumiendo el MISMO RPC `auditoria_resumen` (nuevo `AdminService.getAuditoriaResumen`). Solo online (mensaje claro offline). Filas = la tabla existente.

**Dependencias SGC (PROMPT-1) que deben estar desplegadas para que P7 y P12 funcionen de punta a punta:** RPCs de odómetro (no-retroceso) en checklist/entrega/mantenimiento y `registrar_devolucion_obra`. La migración P12 ya está en `SGC/sql/2026-07-20-p12-devolucion-obra.sql`.

**Próximos pasos:** (1) device-QA en APK real + iOS PWA de FASE 0/1; (2) leer los 4 atascados en `/pendientes`; (3) tu OK para commit + build/publish del APK (bump de versión); (4) decidir idempotencia de `registrar_devolucion_obra`.

## Estado de release (2026-07-18) — v1.16.0 PUBLICADA (Actualización 1: login conductor, tipos, visibilidad, imágenes)
Source: `C:\developer\improvements\imp 17072026\CONTEXTO-ACTUALIZACION-1.md` (P3–P6, parte app) + SGC HANDOFF (PROMPT-3). Consume lo que dejó el SGC (edge `conductor-login`, RLS de flota, tipos). `npm run build` verde.
- **PUBLICADA a usuarios: 1.16.0** (rollout NO bloqueante — banner "nueva versión") · **mínima forzada: 1.15.0** (piso = fix del crash de foto; quien esté por debajo sí queda bloqueado). 1.15.0 quedó despublicada. APK firmado (cert prod `3c5316d8…df5065`, permiso CAMERA presente, 8.0 MB) en el bucket, `apk_url` OK, historial `app_versiones` (movil) con 4 cambios estructurados. Commit `6575f05` en `main` (dispara deploy PWA para iOS). `version_publicada()` → publicada 1.16.0 / minima 1.15.0.
- **P5 — Login conductor (cédula + PIN):** pestañas "Con correo" / "Soy conductor" en `pages/auth/login`. `AuthService.signInConductor()` llama a la **edge pública `conductor-login`** (que aplica el bloqueo 5 intentos/15 min) y hace `setSession`. **Código manda:** se usa la edge, NO `signInWithPassword` directo (eso saltaría el lockout). Maneja 401 (incorrecto) y 429 (`retryInSeconds`). Post-login igual al de correo (perfil activo + módulos → `pin-setup`), respeta `authGuard→pinGuard→moduleGuard`. UX: teclado numérico, targets grandes, y `pin-setup` aclara que el PIN local (desbloqueo del teléfono) ≠ PIN de acceso.
- **P4 — Tipos de vehículo:** nuevo `core/models/vehiculo-tipos.model.ts` con `VEHICULO_TIPOS` (moto/automovil/suv/pickup/camión/maquinaria…) + `claseVehiculo()` con `TIPOS_LIVIANOS` (moto/auto/suv/pickup/otro = Liviano) — **idéntico al SGC**; re-exportado desde `checklist-preuso.model` (imports intactos, specs OK). `vehiculo-form` usa selector; `vehiculo-card` muestra el label RD. El checklist de pre-uso filtra por clase correctamente.
- **P6 — Visibilidad de inactivos:** verificado — `getVehiculosDisponibles` (pool/pre-uso/combustible/rutas) y `getFlota` ya filtran `activo=true`; con la RLS nueva del SGC quedan doblemente cubiertos. Sin cambio de código; el catálogo se re-hidrata online.
- **P3 — Imágenes:** nuevo `shared/ui/img` (`app-img`): reserva espacio, shimmer, **fade-in**, `loading=lazy`+`decoding=async`, fallback, respeta `prefers-reduced-motion`. Aplicado a card de vehículo, perfil de vehículo, foto de combustible y thumbnails de documentos.
- **Contrato SGC consumido:** edge `conductor-login` (`{cedula,pin}` → 200 `{access_token,refresh_token}` / 401 / 429 `{retryInSeconds}`); email sintético `c-{cedula}@conductores.constructorasd.local` (lo genera la web, admin/flota); RLS de `vehiculos` oculta `activo=false` a normales; `VEHICULO_TIPOS`/`claseVehiculo` con livianos = moto/auto/suv/pickup/otro.
- **Release:** bump 1.15.0 → **1.16.0** (environments + build.gradle + release-apk) — construido, publicado y marcado publicada (ver estado arriba). No forcé 1.16.0 como mínima porque son features; `MIN_VERSION` del script sigue en 1.15.0 (alineado con la fila `minima`). Si se quiere obligar 1.16.0: `minima=true` en esa fila desde SGC.
- **PENDIENTE (device-QA — tu hardware):** login cédula+PIN en APK Android e iOS PWA (incl. 429 tras 5 intentos y reset de PIN desde la web); vehículo desactivado desaparece del pool del usuario normal.

## Estado de release (2026-07-17) — v1.15.0 PUBLICADA + MÍNIMA FORZADA
- **Publicada a usuarios: 1.15.0** · **mínima forzada: 1.15.0** (gate BLOQUEANTE — todos deben actualizar; `version_publicada()` devuelve `version_minima=1.15.0`/code 1015000). 1.6.0 y 1.14.0 despublicadas. APK firmado (cert prod `3c5316d8…df5065`) en el bucket, `apk_url` OK, historial `app_versiones` (movil) con 8 cambios estructurados. `MIN_VERSION` del script alineado a 1.15.0 (commit `b4118ac`). Commits en `main`: `4ce35b9` (feat) · `e2b8f8b` (handoff) · `b4118ac` (MIN_VERSION) · `c8bc847` (CLAUDE toolchain). Push a `main` dispara el deploy de la PWA (iOS).

### M1 — CRASH DE FOTO EN ANDROID (pre-uso): CAUSA RAÍZ
**El APK nunca tuvo el permiso `android.permission.CAMERA`.** Ni `android/app/src/main/AndroidManifest.xml` ni el plugin `@capacitor/camera` lo declaraban — confirmado en el manifest **mergeado** del build release (solo INTERNET, REQUEST_INSTALL_PACKAGES, ACCESS_NETWORK_STATE, biometría). Cadena exacta del crash:
1. Sin `CAMERA` del SO, `navigator.mediaDevices.getUserMedia({video})` está **denegado dentro del WebView** de Capacitor (el `BridgeWebChromeClient.onPermissionRequest` solo concede `VIDEO_CAPTURE` si la app ya tiene el permiso runtime).
2. → la **cámara embebida** introducida en v1.14.0 (overlay `in-app-camera`, `getUserMedia`) **nunca funcionó en Android**: `start()` lanzaba y el overlay caía al estado de error *"No se pudo abrir la cámara dentro de la app → Usar la cámara del teléfono"*.
3. → el usuario tocaba ese botón (creyéndolo el flujo normal) → se abría la **cámara del SISTEMA** (`Camera.getPhoto`) → el proceso del WebView pasaba a segundo plano → en **Xiaomi/MIUI** el SO lo mataba por memoria → al volver, la app arrancaba en frío en el bloqueo/menú = el "crash" reportado.
- **Implicación clave:** publicar la 1.14.0 tal cual **no** lo habría resuelto (la cámara embebida seguía muerta sin el permiso); v1.14.0 puso la infraestructura correcta pero le faltaba la llave. El punto de muerte **no** era `capturar()`/`toBlob`/ArrayBuffer, sino la cámara del **sistema** (fallback).

### M1 — FIX (v1.15.0)
- **`+ android.permission.CAMERA`** (+ `uses-feature android.hardware.camera required=false`) en el manifest → **verificado presente en el manifest mergeado del APK release**. Ahora `getUserMedia` funciona → la captura ocurre DENTRO de la app y ya no salta a la cámara del sistema → se elimina el disparador del kill de MIUI. El `Camera.requestPermissions` que ya estaba en `takePhoto()` por fin puede pedir/otorgar el permiso.
- **Endurecimiento** (`in-app-camera.ts` `capturar()`/`stop()`, `camera.service.ts` `takePhoto()`): todo en try/catch, libera el canvas (`width/height=0`) y el `MediaStream`, y ante fallo de compresión **no cierra el overlay** (toast + reintento) — ninguna excepción/OOM tumba la vista.
- **Red de recuperación:** store Dexie `borrador_fotos` (v2, ArrayBuffer WebKit-safe) + autosave del pre-uso → banner **"Continuar borrador"** (respuestas/km/combustible/fotos guiadas/fotos de fallas/firma) si el SO igual matara el proceso; se limpia al enviar.
- Archivos: `android/app/src/main/AndroidManifest.xml`, `src/app/shared/ui/in-app-camera/in-app-camera.ts`, `src/app/core/services/camera.service.ts`, `src/app/core/db/app-db.ts`, `src/app/core/services/borrador.service.ts`, `src/app/pages/transporte/preuso/preuso.{ts,html}`.
- **Conductores/Vehículos (consumen el SGC ya aplicado, verificado contra la BD):**
  - **C1** categorías de licencia RD (01–06) vía `licencia_categorias` (`LicenciaCategoriasService`, cacheado) en el select del alta + etiqueta en el reporte de pre-uso.
  - **C3** `nota` + `tags` del conductor (form con chips + sugerencias; chips/nota en el perfil).
  - **C4/C5** cédula + **licencia (frente y dorso)** opcionales en el alta/edición (se encolan con el id, offline-safe), **preview** al capturar y **thumbnail** de los ya cargados; el perfil muestra **todas** las fotos por tipo. `doc-slot` ahora pinta thumbnail de imágenes existentes.
  - **C6** badge licencia **Por vencer/Vencida** en listado (umbral `flota_config.umbral_licencia_dias`) y perfil.
  - **C7** badge **"Documentos incompletos"** + filtro en el listado (vista `v_conductor_documentos`; `getDocumentosResumen`).
  - **V1/V2** **VIN**, número de matrícula, número de seguro y **aseguradora** en el alta y el perfil del vehículo (foto por los slots existentes).
- **Contrato SGC consumido (verificado en la BD compartida):** `conductores.nota/tags`, `vehiculos.vin/numero_matricula/numero_seguro/aseguradora`, tabla `sgc.licencia_categorias` (codigo/nombre/clase/orden), vistas `v_conductor_documentos` (conductor_id/tiene_cedula/tiene_licencia/total) y `v_conductor_stats`.
- **PENDIENTE (device-QA — no pude, no tengo el equipo):** probar en **APK real (MIUI del reporte)** el flujo pre-uso capturar→confirmar→subir sin crash + recuperar borrador tras matar la app; y en **iOS PWA** el mismo flujo de foto. Todo lo demás verificado con `npm run build` verde en cada fase.
- **Pendientes de confirmar con el jefe (§E, no bloquean):** seed de categorías 01–06 (ajustable en SGC si el mapeo real difiere); `umbral_licencia_dias` = 90 para "3 meses"; datos extra del seguro si los quiere.

## Estado de release (2026-07-17) — v1.13.0 PUBLICADA (histórico, superado por 1.15.0)
- **Publicada a usuarios: 1.13.0** (rollout no bloqueante) · **mínima forzada: 1.6.0** · APK en el bucket con `apk_url` OK.
- **1.13.0 — persistencia de borradores + fix de fotos (PWA iOS/WebKit):**
  - **Fase 1 (causa raíz):** `fotos_pendientes` guardaba `Blob`/`File` directo → error WebKit "Error preparing Blob/File data…" (foto de combustible obligaba a "repetir foto"). Ahora persiste **ArrayBuffer + type** y reconstruye el `Blob` al subir (`SyncService.enqueue`/`uploadPhotos`). Central: cubre todos los flujos de fotos. Compresión ya existía en `CameraService`.
  - **Fase 2 (autosave):** `core/services/autosave.service.ts` — debounce 600ms + flush en `visibilitychange`(hidden)/`pagehide` (no `beforeunload`). Aplicado a checklist, alta/edición de conductor y vehículo; `parte` ya autoguardaba (+meta).
  - **Fase 3 (recuperación):** `shared/ui/draft-banner` "Tienes un borrador… Continuar/Descartar" en esos formularios (rehidrata estado; fotos se re-toman).
  - **Fase 4:** `pages/en-proceso` "Documentación en proceso" (link en Ajustes) lista borradores sin enviar (`BorradorService.list` + meta tipo/etiqueta/ruta) para retomar/descartar.
  - **Fase 5:** km del pre-uso arranca vacío (último km como referencia); checklist/combustible ya arrancaban vacíos.
  - **IndexedDB:** solo cambian shapes de valor (no stores/índices) → sin bump de versión Dexie; filas viejas siguen leyéndose (fallback a `blob`).
- **1.12.0 — gestión de flota en la app (paridad web, todo gated por rol):**
  - **Vehículos (admin):** crear/editar (`transporte/vehiculos/nuevo`, `/:id/editar`) — placa/marca/modelo/año/tipo/estado/km/vencimientos matrícula-seguro/mantenimiento/notas + subir foto (bucket vehiculos). Botón "Agregar vehículo" (lista) + "Editar vehículo" (perfil). RLS `vehiculos:write=is_admin`. Shape validado contra la BD.
  - **Conductores:** editar (relinkear usuario, licencia, tipo) + desactivar (`transporte/conductores/:id/editar`); "Editar" en el perfil (admin).
  - **Asignar vehículo a otro conductor** (admin) desde el perfil del vehículo (cierra la activa e inserta la nueva).
  - **Avisos de flota** (`transporte/avisos`): pendientes (pre-cita, seguro/matrícula, hallazgos) + `reactivar_vehiculo` o marcar atendido. Enlace en el home.
  - Servicios: `VehiculosService.getVehiculoFull/crearVehiculo/actualizarVehiculo/subirFotoVehiculo/asignarAConductor/getAvisosFlota/reactivarVehiculo/atenderAviso`; `ConductoresService.getConductor/actualizarConductor/setConductorActivo/getUsuariosVinculables/crearConductor`.
- **1.11.0 — arreglo relaciones conductor + alta de conductor** (bug `.maybeSingle()` con conductor duplicado; datos QA-TEST limpiados; alta con vínculo a usuario).
- **1.11.0 — arreglo relaciones conductor + alta de conductor:**
  - **Bug corregido:** `getMiConductor` usaba `.maybeSingle()` → reventaba con "multiple rows" cuando un usuario tenía >1 conductor activo (había un duplicado **QA-TEST** ligado al usuario de Tecnología) → decía "no eres conductor". **Datos:** desactivada la fila QA-TEST duplicada (queda solo el conductor real). **Código:** `getMiConductor` ahora `order(created_at desc).limit(1)`. El fix de datos ya aplica en la app instalada al re-sincronizar.
  - **Alta de conductor (admin):** `transporte/conductores/nuevo` — vincular a un usuario del sistema (`usuarios_vinculables()`, autollena nombre/cédula) o sin usuario; licencia + tipo. `ConductoresService.crearConductor()` (insert directo, RLS is_admin OR flota). Botón "Agregar conductor" en la lista, gated a admin.
- **1.10.0 — perfiles de flota navegables:** pantallas **Vehículos** (`transporte/vehiculos` → perfil) y **Conductores** (`transporte/conductores` → `transporte/conductor/:id`, solo lectura con stats + docs). Enlaces en el home.

### Paridad flota web↔app — estado y pendientes
- ✅ Listas + perfiles de vehículos y conductores (navegar/elegir).
- ✅ Alta de conductor + vincular usuario (admin).
- ✅ **Gestión de vehículos (crear/editar/fotos/vencimientos)** — admin (v1.12.0).
- ✅ **Editar conductor** + desactivar (v1.12.0).
- ✅ **Avisos de flota / reactivar vehículo** (v1.12.0).
- ✅ **Asignar vehículo a otro conductor** (admin, v1.12.0).
- Dashboards analíticos (combustible, cumplimiento) — se quedan en web por diseño.
- Historial `sgc.app_versiones` (movil) al día y estructurado: 1.10.0 (perfiles flota) · 1.9.2 (fix cantidades bitácora) · 1.9.1 (registro auto + versión en Ajustes) · 1.9.0 (B1–B5) · 1.8.0 (docs) · …
- **Automatización Y1**: `npm run apk` (build) ya registra la versión estructurada solo (falla si no puede). `apk:publish` además sube el APK. La app también auto-reporta su versión al arrancar (admin, red de seguridad).
- **Fix bitácora (1.9.2)**: en "¿Qué se hizo hoy?" eliges la parte y al tocar cada actividad aparece al instante su selector de cantidad (se quitó el botón "+ Agregar a la lista" escondido).
- **Corrección de estado**: 1.9.0 había quedado "publicada" SIN apk en el bucket (in-app update roto); se corrigió publicando 1.9.2 (que sí tiene apk). El toggle publicada/mínima sigue siendo control del admin en SGC.
- **Pendiente**: device-QA en 1.9.2 (el teléfono no conecta hoy — USB intermitente). APK en `android/app/build/outputs/apk/release/app-release.apk` y descargable del bucket (`csd-app-1.9.2.apk` / `csd-app-latest.apk`).

## Actualización 7 (B1–B5, B7, Y1-app) — build verde, NADA commiteado/pusheado (2026-07-16)
Cierre de las brechas móviles del CUMPLIMIENTO + regla de historial de versiones. `npm run build` OK (exit 0). Bump **1.8.0 → 1.9.0**. APK 1.9.0 firmado (cert prod 3c5316d8…). **Nota:** B4 (U3 autollenado), Y2 (dashboard auditoría) y B6 (QA-057 destacada) son **web/SGC**, fuera de esta ronda app.

- **B1 (U1) — pool en todos los flujos:** nuevo `shared/ui/vehiculo-picker` (reusa `getVehiculosDisponibles` + `VehiculoCard`). Embebido como paso-1 en **pre-uso** y **combustible** (gate `necesitaVehiculo` cuando no llega `vehiculoId` por ruta; deep-link salta el paso). **Rutas**: se quitó el empty-state bloqueante; ahora elige del pool con el picker + cabecera "Vehículo: … / Cambiar".
- **B2 (X1) — documentos móvil:** (a) perfil del conductor con banner "Documentos pendientes" + subir/reemplazar **ya estaba** desde Act. 6 (`mi-actividad`). (b) `perfil-vehiculo`: seguro/matrícula ahora **se pueden subir/reemplazar** si el rol tiene módulo **flota** (admins incluidos); otros roles → solo-lectura. Vía `DocumentosService` (outbox, offline).
- **B3 (U25+V14) — "Otro/s" estructurado:** se llama `registrar_otro_valor(contexto, valor, ref)` (SECURITY DEFINER, best-effort tras el RPC principal): **entrada** origen "Otro" → contexto `entrada_referencia`; **requisición** materiales del "08 Otros" (sin articulo_id) → contexto `material`. **Contradicción código-manda flagueada:** la descripción libre de "08 Otros" **no** se puede habilitar como línea de salida/entrada — `registrar_salida_app`/`registrar_entrada_app` exigen `articulo_id` uuid real y mueven stock (la categoría Otros tiene 0 artículos). Los materiales no catalogados van por **requisición** (que ya lo soporta). Si se quiere entrada de no-catalogados, requiere cambio de RPC (SGC).
- **B5 — consistencia:** foto opcional de **salida y entrada** con `PhotoSlot` (no botón plano). Nuevo `shared/ui/wizard-footer` adoptado en **9 pantallas** (salida, entrada, pedir, checklist, combustible, mantenimiento, reporte-semanal, parte, liberación); **pre-uso** quedó con su footer propio (lógica por-paso: disabled + "Faltan N fotos"). Teclado: `android:windowSoftInputMode="adjustResize"` en el manifest → el CTA nunca queda tapado.
- **Y1 (app) — historial confiable:** `release-apk.mjs` registra SIEMPRE estructurado (`p_titulo` + `p_cambios[{t,d}]`, mismo shape que la web), genera cambios de commits si no hay curados (feat→nuevo, fix→arreglo, perf/refactor→mejora, sec→seguridad), y **falla el release (exit 1) si no pudo registrar**. Regla documentada en `CLAUDE.md` (§ Versionado/historial). El backfill de las filas móviles viejas al formato estructurado **ya está hecho** (lado SGC: 1.7.1/1.7.2/1.8.0 tienen titulo+cambios). Verificado end-to-end con una versión QA-TEST (registrada estructurada + borrada).
- **B7 — doc:** `QA-FINDINGS.md` con nota de reconciliación (app en 1.9.0; filas "⏳" ya cerradas = estado del resumen ejecutivo; 0 pendientes app-side).

**Pendiente:** device-QA en 1.9.0 (el device se desconectó al instalar; APK listo en `android/app/build/outputs/apk/release/app-release.apk`). Probar: pre-uso/combustible/rutas sin vehículo (picker) y con deep-link (salta); subir doc de vehículo con rol flota vs bloqueado con rol normal; "Otro/s" llegando a `otros_valores` desde entrada/requisición; foto de salida con PhotoSlot; footer + teclado abierto. **Publicar 1.9.0 (`npm run apk:publish`) + commit/push: a tu OK.**

## Actualización 6 (X1–X4) — build verde, NADA commiteado/pusheado (2026-07-16)
Documentos de conductor/vehículo + aviso de GPS + confirmación de foto en salidas. `npm run build` OK (exit 0).

**⚠️ Contradicción con el prompt (el código manda):** el prompt decía bucket `documentos/{entidad}/{id}/…`.
En la BD real **no existe** un bucket `documentos`; el que creó PROMPT-13 se llama **`flota-documentos`**
(privado). Se usó ese. La tabla `sgc.documentos` (id/entidad/entidad_id/tipo/nombre/path/subido_por/created_at)
**sí existe**; RLS de tabla y de storage: `is_admin() OR tiene_modulo('flota')` para INSERT/SELECT/DELETE
(sin RPC → el app inserta directo por PostgREST). No hizo falta migración.

- **X1 documentos — nuevo:** `core/models/documento.model.ts`, `core/services/documentos.service.ts`
  (getDocumentos cacheado offline, getSignedUrl, tiposEnCola desde el outbox, `enqueueDocumento` → outbox
  `documento_upload`: sube el blob a `flota-documentos/{entidad}/{id}/{tipo}_{uuid}.{ext}` y hace UPSERT
  en `sgc.documentos` con id=UUID cliente = idempotente). Nuevo `shared/ui/doc-slot` (foto con cámara O
  archivo/PDF; modo `soloLectura` para vehículos). `camera.service`: `pickDocument()` (input file
  image/*,pdf; comprime imagen, PDF tal cual) + `takeDocumentPhoto()`.
  - **Conductor (auto-registro, `asignar`):** sección "Documentos" con slots **Cédula** y **Licencia**
    (requeridos pero NO bloqueantes). Se encolan tras `auto_registrar_conductor` con el `conductor_id`.
  - **Conductor (perfil, `mi-actividad`):** banner "Documentos pendientes: cédula · licencia" (no bloquea),
    slots para ver (signed URL) / subir / reemplazar. Funciona offline (encola + sube al reconectar).
  - **Vehículo (`perfil-vehiculo`):** sección "Documentos" **solo lectura** (Seguro, Matrícula, otros N).
    Se suben desde la web; el app solo los ve.
- **X2 GPS entrega/recepción — ya se mandaba** (`checklist.captureGps` → `enqueueEntrega` `p_gps` →
  `crear_entrega_vehiculo(p_gps jsonb)` persiste). **Añadido:** estado visible en el resumen
  (📍 Capturada / Obteniendo… / Sin ubicación) + mensaje claro y botón "Reintentar ubicación" cuando el
  permiso está denegado o no hay señal. **Nunca bloquea** (se registra "sin ubicación"). El mostrarlo en
  la web (mini-mapa/coords) es **lado SGC**.
- **X3 fotos por-ítem del pre-uso = lado SGC** (la app ya sube `item_N`; la web debe pintarlas). Fuera de scope app.
- **X4 foto en salidas — ya estaba en el app** (`salida.foto` + `enqueueSalida` → `fotoOf` sube a
  `{id}/evidencia.jpg` → `registrar_salida_app(p_foto_path)`). Mostrarla en el detalle web es **lado SGC**.

**APK QA:** bump **1.7.2 → 1.8.0** (versionCode 1008000) en `build.gradle` + `environment(.prod).ts` +
`release-apk.mjs` (VERSION + changelog/TITULO de Actualización 6 ya redactados). `npm run apk` → APK
firmado (cert prod SHA-256 3c5316d8…df5065) **instalado** en device 6dbf1af4 (`adb install -r` → Success).
**NO publicado** (no se corrió `release-apk.mjs`; bucket/mínima intactos).

**Pendiente:** device-QA en 1.8.0. Probar: auto-registro con docs (online/offline), banner pendientes,
ver docs de vehículo, entrega/recepción con y sin permiso de GPS, salida con foto — y verificar en SGC web.
**Ojo:** el auto-registro/subida escribe en producción (conductor ligado a tu usuario real / vehículos
reales) → usar registros QA-TEST. **Publicar 1.8.0 (`npm run apk:publish`) + commit/push: a tu OK.**

## Actualización 4 (W1–W7) — build verde, NADA commiteado/pusheado
Bitácora: fotos ilimitadas + equipos alquilados + paridad con la web. `npm run build` limpio.
Backend: 2 migraciones aditivas aplicadas (crear_bitacora_app canónico + mis_rutas_hoy.notas).

- **W1 fotos sin límite:** `camera.service.pickFromGallery()` (multi-pick nativo `Camera.pickImages` /
  input múltiple PWA, comprimido). Paso de fotos de la bitácora: botones **📷 Cámara** + **🖼️ Galería**,
  contador de agregadas, sin tope duro (batch hasta 40 configurable). Sube por outbox (cada foto es un
  `fotos_pendientes` slot `foto_i` → el handler arma `p_fotos`) sin bloquear el envío. El detalle ya
  las muestra todas.
- **W2 equipos alquilados:** paso "¿Hay equipos alquilados en uso hoy?" (Sí/No + lista dinámica:
  equipo con `<datalist>` de sugerencias `getEquiposSugeridos()`, uso obligatorio, proveedor opcional).
  Viaja en `crear_bitacora_app` (`p_hubo_equipos`/`p_equipos_alquilados`) → `bitacora_equipos_alquilados`
  + alimenta `otros_valores` (U25). Visible en el detalle. **Nota:** PROMPT-9 ya había extendido el RPC;
  quité una sobrecarga redundante que dejé y unifiqué en UNA función canónica.
- **W3 paridad bitácora:** auditoría campo-por-campo (tabla abajo). Cerrado en la app: **bloque_entrepiso,
  ingeniero_responsable, hora_fin_trabajo** (parte, opcionales en el resumen), **incidente_subcontratista**
  + **incidente_acciones** (incidente), y render de todo + `created_at` en el detalle. RPC extendido
  aditivamente con esos params (los escribía el form web por insert directo; ahora la app también).
  **Deferido con razón:** tipo `visita` (flujo nuevo completo, bajo uso en campo) y `weather_snapshot`
  auto (contradice R21 — la fuente de verdad del clima es la respuesta del usuario, no el weather API);
  y export Excel/print (app de campo/offline). Flagueados para tu decisión.
- **W4 barrido visualización:** corregido lado app → **ruta.notas** (se capturaba, no se veía;
  `mis_rutas_hoy` ahora devuelve `notas`, se muestra en la tarjeta de ruta). **Lado web (SGC) — para el
  próximo prompt:** (1) GPS de entrega/recepción de vehículo (se manda `p_gps`, la web no lo modela ni
  muestra en flota/responsabilidad); (2) fotos por-ítem del checklist pre-uso (`item_N` en
  `checklist_vehiculo_fotos`, la web solo pinta los slots fijos); (3) foto de salida no-conduce
  (inventario/salidas no tiene botón 📷 como entradas).
- **W5 skeletons:** barrido app OK — toda pantalla que carga datos tiene skeleton (directo o vía
  `selector-categorias [loading]`). El "Cargando…" que queda es el botón "Cargar más" de auditoría (ok).
  **W5-web (skeletons en TODOS los módulos de SGC) = lado web, para el próximo prompt.**
- **W6 (auditoría → dashboard analítico) = lado web (SGC)**, fuera de este repo. Para el próximo prompt.
- **W7 versiones auto:** `scripts/release-apk.mjs` registra la versión vía RPC idempotente
  `registrar_version('movil', VERSION, notas)` (notas = changelog curado, editable). La publicación a
  usuarios sigue siendo manual del admin (R15). El auto-registro web es lado SGC.

**Pendiente:** device-QA del nuevo flujo (20+ fotos offline, equipos en el detalle, campos de paridad) —
requiere rebuild del APK (el device tiene 1.6.0 sin este código) o correr la PWA. Commit/push a tu OK.

---

## Actualización 3 (V1–V15) — build verde, APK 1.6.0 firmado local, NADA pusheado/publicado
Ronda de bugs de versionado/instalación, rediseño de inventario/requisición por el catálogo
oficial, skeletons, tarjetas de vehículos, reporte semanal por pool y verificación V15.
`npm run build` limpio. Bump **1.5.0 → 1.6.0** (versionCode ahora se DERIVA del nombre en Gradle:
1.6.0 → 1006000). **No commit / no push / no publicar** hasta tu OK.

**FASE 0 — bugs visibles**
- **V6/V11 (CTA invisible):** el host `<app-selector-categorias>` no tenía layout flex → el footer
  "Siguiente" se desbordaba/recortaba. Fix `:host{display:flex;flex:1;min-height:0}` + grid/list
  `min-height:0` + barra `flex:0 0 auto; position:sticky; bottom:0`. Mismo endurecido en `asignar`
  y `salida/entrada` (`.mov__nav`). El CTA de avance ya no puede quedar invisible.
- **V2 (verificar versión mentía):** en el APK el botón sólo miraba el service worker (deshabilitado
  en nativo) → siempre "ya tienes la última". Ahora `VersionService.checkFresh()` consulta
  `version_publicada()` **sin caché** y compara semver; si hay nueva → va a `/actualizar`.

**FASE 1 — rolling update + firma (V3/V4/V5)**
- **V3:** plugin nativo `ApkInstaller` (android/.../ApkInstallerPlugin.java, registrado en
  MainActivity) + `UpdaterService` (descarga el APK de `apk_url` a caché con progreso vía
  Filesystem.downloadFile, luego intent de instalación con FileProvider). Manifest:
  `REQUEST_INSTALL_PACKAGES`. Página `/actualizar` (barra de progreso, permiso "apps desconocidas",
  errores visibles). PWA: enlace de descarga directa.
- **V4:** banner tappable global "Nueva versión X.Y disponible" (`app.html`) → `/actualizar`. El gate
  bloqueante también usa el updater in-app. ⚠️ **Push OS real NO** (no hay FCM/plugin push) — la
  "notificación in-app" es el banner. Push requiere Firebase + tu config (pendiente, avísame si lo quieres).
- **V5:** keystore estable **`C:/Users/xavie/keystores/constructorasd.keystore`** (alias
  `constructorasd`), **FUERA del repo**. Es el **MISMO certificado** que produccón (era
  `csd-release.keystore` alias `csd`; sólo cambió el nombre y el alias vía `keytool -changealias`,
  cert SHA-256 idéntico `3C:53:16:D8:…:65`) → los APK nuevos instalan ENCIMA sin conflicto de firma.
  `keystore.properties` apunta ahí. versionCode auto-derivado. Script `npm run apk` (build+sync+
  gradle+verifica cert) y `npm run apk:publish`. **⚠️ RESPALDA** `constructorasd.keystore` +
  `keystore.properties` fuera de esta máquina. **Play Protect:** con firma estable + targetSdk 36 +
  manifest limpio baja el warning en updates; eliminarlo 100% sólo por Play Store (documentado).

**FASE 2 — skeletons + conteo (V7/V8)**
- **V7:** auditoría completa (agente). Arreglados los 3 huecos duros (liberacion, preuso,
  conduces/entrega mostraban "Cargando…"/no-encontrado durante la carga) + `selector-categorias`
  gana input `loading` (shimmer) usado por salida/entrada/requisición + incidente. El resto de la
  app ya tenía skeleton.
- **V8:** conteo permite guardar sin cambios → confirma "todo conforme" (el RPC ya lo soporta,
  registra "Todo conforme — sin diferencias"). Botón pasa a "Guardar (sin diferencias)".

**FASE 3 — catálogo oficial + requisición por hojas (V14/V13)**
- **V14:** artículos ahora traen `requiere_talla` + `nota`; cache offline invalidada (keys `_v2`).
  EPP con `requiere_talla` pide talla obligatoria (modal S/M/L/XL + libre) al agregar; `nota` de
  atado/paquete visible como ayuda. La talla viaja en `detalle_salidas.talla` (salida) y como
  "(Talla X)" en la descripción (requisición). Categorías en orden oficial 01→08.
- **V13:** requisición (`pedir`) reescrita con el patrón de hojas (reusa `SelectorCategorias` en
  modo `requisicion`): categorías → categoría/stepper → resumen editable (obra + urgencia) → éxito
  con **compartir por WhatsApp**. "Otros" (08) permite describir material libre (articulo_id null +
  descripción → `crear_solicitud_app`). Offline vía outbox.

**FASE 4 — vehículos + reporte semanal (V11/V10/V15)**
- **V11:** nuevo `shared/ui/vehiculo-card` (foto/placeholder + tipo·km legibles) usado en el pool de
  `asignar` (tarjeta seleccionable) y en el picker del reporte semanal.
- **V10:** reporte semanal ahora lista **todo el pool** (`getVehiculosDisponibles`), no sólo los
  asignados; cualquier conductor elige y reporta. Sin guard de asignación (el RPC tampoco lo exige).
- **V15:** corregidas las desviaciones vs las pantallas del jefe — combustible (card "km última
  echada", "Fotos obligatorias", labels "Recibo"/"Tablero (km)", texto de respaldo, "Kilometraje
  actual"); datos de salida (card con último km + "Mantenimiento cada N km · próx. X", línea PRE-CITA
  con próximo km, botón "Continuar al checklist" deshabilitado hasta km+combustible); fotos (secciones
  EXTERIOR—4 / INTERIOR—3, "Toca cada recuadro…", botón "Faltan N foto(s)").

**FASE 5 — bitácora (V12a-d): YA estaban implementados en 1.5.0**
- Verificado: **V12a** cantidad por actividad (stepper + input + plan de partida, viaja al RPC
  `crear_bitacora_app.cantidad` y se ve en el detalle), **V12b** CLIMA quitado (activo=false en DB +
  fuera del const; `getCatalogos` filtra activo), **V12c** "Describa…" obligatorio por restricción
  (guard en paso 6), **V12d** el detalle muestra fotos (galería con signed URLs) + cantidad +
  descripción. El tester los vio "sin implementar" porque **producción sigue en 1.4.0** (1.5.0 se
  compiló pero nunca se publicó). Se resuelven al publicar 1.6.0.
- ⚠️ **SGC web (regla #5):** confirmar que la web muestra cantidad por actividad + descripción de
  restricción + fotos de bitácora (las fotos ya; cantidades/descr pendiente de verificar — avísame).

**Pendiente / tu decisión:**
- Publicar 1.6.0 (`npm run apk` ya deja el APK firmado; luego `npm run apk:publish` sube al bucket y
  registra en historial — **NO lo corrí**; publicar sube `min`/oferta a los de campo).
- Device-QA: instalar 1.6.0 ENCIMA de una versión anterior (valida V5 sin desinstalar), actualizar
  desde la app (V3), salida/requisición por hojas + talla EPP + Otros, conteo conforme, reporte
  semanal desde el pool, V15, bitácora completa. Offline→reconnect en los flujos tocados.
- Respaldar el keystore. (Opcional) push OS real vía FCM para V4.

---

## Actualización 2 — cierre de gaps (auditoría contra código) — build verde, 17/17 tests, NADA commiteado
Branch **`feat/actualizacion2-movil`**. Auditamos U1–U25 contra el código real (4 agentes). U1/U8/U10/U11/U12/U13/U18/U19/U20/U21/U24 ya estaban DONE. Cerramos los gaps reales:

- **U22 (origen obra/almacén):** crear-ruta ahora tiene selector de obra/almacén también para el ORIGEN (usa sus coords), no solo destino. Botón "🏗️ Elegir una obra o almacén" + `onOrigenLugar()`.
- **U23 (duración legible):** `formatearDuracion` estaba muerto (0 usos) y no había fuente de duración. Añadido `GeocodingService.ruta()` (OSRM keyless) → crear-ruta muestra **"Tiempo estimado: 1 h 28 min"** cuando hay coords de origen+destino, y autollena km. Offline = silencioso (no bloquea).
- **U25 (entrada "Otro"):** inventario/entrada motivo "Otro" abría literal "Otro"; ahora abre campo obligatorio "Especifica de dónde viene…" y envía ese texto como `referencia` (llega al backend/web, no se pierde). ⚠️ Feed a `otros_valores` desde entrada requeriría param en el RPC `registrar_entrada_app` (scope SGC) — la bitácora sí lo hace vía `descripcion_otro`.
- **U9 (fechas es-DO):** quitado ISO crudo en preuso (matrícula/seguro vencidos → `formatFecha`) y todos los `| date` reemplazados por el util es-DO (`formatFecha`/`formatFechaMedia`/`formatFechaHumana`) en mis-partes, detalle, mi-actividad, solicitudes/mis, admin/reportes, admin/conteos, admin/auditoria.
- **U6 (foto vehículo):** `getVehiculo()` trae `foto_path`; foto en **perfil-vehículo**, header de **combustible**, **lista del reporte semanal** y **selector de vehículo de crear-ruta** (`SelectList` ahora acepta `image?` opcional y muestra thumbnail; retrocompatible). Cubre listas + selectores + perfil.
- **U4 (no perder datos / botón físico):** nuevo `NavGuardService` + listener global de `backButton` en `app.ts` (`@capacitor/app@8` instalado + `cap sync` hecho). Nueva base `shared/guarded-wizard.ts` (`GuardedWizard`): preuso/combustible/reporte-semanal/reportar ahora confirman "¿Descartar cambios?" (y combustible/preuso ganaron botón **Cancelar** en el paso 1 — antes eran dead-ends). crear-ruta/salida/entrada/bitácora-parte registran también la guarda del botón físico Android.
- **U5:** N/A — la app no tiene inputs de teléfono (util `telefono.ts` listo si se agrega alguno). **U17:** solo-web (la app no tiene módulo tecnológico).

**Device-QA hecho (device 6dbf1af4, APK v1.5.0 rebuild con `@capacitor/app`):** ✅ U4 botón
físico Android → "¿Descartar la inspección?" en preuso (Seguir aquí conserva / Sí descartar sale)
+ "¿Descartar la ruta?" y "¿Salir de la entrada?"; ✅ U22 origen por obra/almacén (BRISAS);
✅ U23 ETA OSRM "5 min" + km autollenado (BRISAS→Torre Alpha); ✅ U6 thumbnail del vehículo en el
selector de crear-ruta; ✅ U25 "Otro" en entrada revela "Especifica de dónde viene…". No pude
seguir tras el re-lock por PIN (device-only).

**BUG pre-existente encontrado y arreglado (footer overflow):** los botones globales `.btn-cta`/
`.btn-ghost` traen `width:100%`; en los footers `[Atrás][Primario]` cuyo back usa `flex: 0 0 auto`
(sin encoger), el back acaparaba el ancho y el **botón primario colapsaba a ~0px (intappable)**.
Confirmado con uiautomator (selcat "Siguiente" 0×0 → tras fix [726,1035]; submit de entrada 17px).
Fix `width:auto` en: `selector-categorias` (Siguiente/Cancelar), `crear-ruta`, `reporte-semanal`,
`salida`/`entrada` (resumen), `liberacion`, `asignar`. preuso/combustible/parte ya se salvaban con
`max-width:120`. **Esto afectaba flujos core (completar salida/entrada, crear ruta, reporte semanal,
liberación) en pantallas ~1080px** — verificar en la web SGC si comparte el patrón.

**Device-QA COMPLETO (con PIN):** además de lo anterior, verificado en device ✅ U6 foto del Amarok
en header de combustible y en el **perfil del vehículo** (perfil muestra foto + stats, "Asignados 2"
= pool U1); ✅ U9 fechas humanas en Mis requisiciones ("13 jul 2026", "8 jul 2026"); ✅ fix del footer
(botón Siguiente/guardar ya no colapsa). Todo U1–U25 verificado en teléfono o por build+review.

**Estado final:** `feat/actualizacion2-gaps` **mergeada a `main` y pusheada** → PWA auto-deploy a
Vercel. APK v1.5.0 (rebuild con `@capacitor/app`) instalado al device, **sin publicar al bucket**
(publicar con `node scripts/release-apk.mjs` solo con tu OK — forzaría min_version a los usuarios).

---

## Actualización 2 móvil (PROMPT-6) — build verde, SQL aplicado, NADA pusheado
Branch **`feat/actualizacion2-movil`** (commit local `fb15068`, no pusheado). Delta de
actualización 2 sobre la app de campo. `npm run build` verde. Falta device-QA + (si se aprueba)
push PWA + bump/APK.

**F1 flota:** U10 pre-uso ahora filtra `frecuencia='preuso'` (nunca la de 33 ítems ni la semanal)
+ clave de caché nueva (`checklist_plantillas_preuso`) que invalida cachés viejos; U8 texto que
explica reporte-semanal vs pre-uso en el hub; U6 foto del vehículo en el selector del pool
(`asignar`, URL firmada bucket `vehiculos`); U1 el pool ya era accesible vía "Asignarme un vehículo".

**F3 bitácora:** U11 quitado 'CLIMA' del catálogo de restricciones; U12 "Describa…" obligatorio por
restricción (envía `descripcion_otro`; RPC ya lo aceptaba); U13 el detalle muestra clima, migración
(obreros) y cantidad por actividad (modelo + select extendidos).

**F2 rutas (sin mapa embebido):** **bug corregido** — las coords de origen se perdían;
`crear_ruta_app` extendido aditivo con `p_origen_lat/lng` (`sql/2026-07-15-crear-ruta-origen-coords.sql`,
aplicado a prod) y el handler las envía; U22 destino por **obra o almacén con sus coordenadas**
(`getLugaresDestino`); U21 botón "usar mi ubicación actual" con permiso nativo + error visible.

**Utilidades (paridad):** `core/util/fecha.ts` (U9 — las fechas ya no eran ISO cruda, usan DatePipe),
`duracion.ts` (U23 — sin fuente de duración aún), `telefono.ts` (U5 — la app no tiene inputs de teléfono).
**U25:** la restricción "OTRO" ahora manda `descripcion_otro` → el trigger de BD la registra en
`otros_valores` (web y móvil), sin cambio de app extra. **U17** (inventario/compras tec) = solo web
(la app no tiene módulo Tecnología).

**F2 mapa interactivo (U18/U19/U20) — HECHO, pendiente walk-through en teléfono:** nuevo
`shared/ui/location-picker` (Leaflet 1.9.4 + OSM): pin por toque, búsqueda RD (Nominatim
`countrycodes=do`, es), "usar mi ubicación actual" (Geolocation nativo + permiso + error visible),
`invalidateSize` para el WebView. `GeocodingService`. Rutas: origen con mapa (toggle) y destino "En
el mapa" además de obra/almacén; coords guardadas. U4 confirmación de descarte en crear-ruta.
Leaflet CSS en angular.json; pin del marcador en styles.scss.

**APK v1.5.0 / versionCode 18:** bump en build.gradle + environments + release-apk.mjs; `npx cap sync`
hecho; **APK release firmado construido e instalado al device 6dbf1af4** (arranca OK, sin crash en
logcat). **NO publicado al bucket** (release-apk.mjs pone `min_version=VERSION` → forzaría a los
usuarios de campo; publicar solo con tu OK).

**Pendiente:** walk-through en el teléfono (mapa: pin/búsqueda/ubicación/obra-almacén; pre-uso 10
tópicos; reporte semanal; bitácora describa+detalle; offline→reconnect). U4 "descartar" en el resto
de wizards (preuso/combustible usan pasos con "Atrás"; falta interceptar el botón físico — es
transversal). U24 fino: los perfiles/dashboards/gestión de avisos quedan solo-web (admin), lo
operativo del chofer está en la app. **Nada pusheado** (branch local `feat/actualizacion2-movil`).

---


## Historial de versiones (timeline admin) — ✅ en prod
Página **solo admin** `admin/versiones` (`moduleGuard('admin')`): línea de tiempo con tabs
App móvil / Web, cada versión con fecha + cambios. Lee `sgc.app_versiones` (extendida en SGC:
`plataforma`/`fecha`/`titulo`/`cambios`; seed histórico curado). `VersionService.historial()` +
tile en el hub admin + ruta. Espeja la web SGC (`admin/historial-versiones`). Build verde.
La 1.4.0 móvil ya está en la tabla (preparada, sin publicar — publícala desde SGC → app-versiones).

## Actualización 1 (14/07 tarde) — Inventario por HOJAS + Reporte semanal v2 — ✅ en producción
`npm run build` limpio. **Commiteado y pusheado a `main`** (merge `97a72f3` `feat/inventario-hojas`) → PWA desplegado a prod (Vercel `csd-app`, deploy `dpl_9JtVX4…` READY). El APK aún requiere bump/firma/publicación manual (no automatizable aquí).
**Refinamiento (esta sesión):** el wizard del reporte semanal ahora **agrupa las preguntas por sección** (encabezados oficiales del papel §B) — antes era lista plana. Cambio solo de UI (`reporte-semanal` .ts/.html/.scss), build verde.
**Bump + release 1.4.0 (esta sesión):** `1.3.2`→**`1.4.0`** / versionCode 16→**17** en `android/app/build.gradle`, `src/environments/*`, `scripts/release-apk.mjs`. PWA en prod. **APK nativo COMPILADO, FIRMADO y PUBLICADO** (el entorno estaba completo: JBR JDK + SDK + keystore): `gradlew assembleRelease` → `apksigner verify` OK (v2, 1 firmante) → `node scripts/release-apk.mjs` subió `csd-app-1.4.0.apk` (8.2 MB) + `csd-app-latest.apk` + `version.json` al bucket `app-releases`. La página **CSD App (móvil)** de SGC ya ofrece la descarga (HTTP 200).
⚠️ Esto solo hace el APK **descargable**. Qué versión se OFRECE/EXIGE a los usuarios de campo sigue controlado por el admin en SGC → app-versiones (R15): la fila `movil 1.4.0` está en `app_versiones` **sin publicar** (publicada/minima = false), así que nadie se ve forzado hasta que la publiques.

**Fase 1 — Inventario navegación por "HOJAS" (rediseño UX de salida/entrada):**
- Nuevo componente reutilizable `shared/ui/selector-categorias` (patrón hojas): hoja de categorías (destacadas primero, badge con # seleccionados por categoría, barra fija con total del carrito + Siguiente) → hoja de una categoría (solo sus artículos, buscador interno, stepper −/+, "Listo" vuelve conservando el carrito). Cart como `model()` de dos vías (lo posee la página, sobrevive a la navegación).
- `salida` y `entrada` reescritas como máquina de hojas: selección → **resumen** (agrupado por categoría, editar stepper/quitar, almacén + nota/motivo, foto opcional) → **éxito** ("Completado con éxito" + **Compartir por WhatsApp** el resumen + "Nuevo registro"). Atrás/cancelar en cada hoja con confirmación si hay carrito.
- `core/util/share.ts` (`compartirTexto` — @capacitor/share nativo / Web Share PWA / fallback a portapapeles). Sin cambios de BD (items multi-categoría ya iban en un jsonb; la categoría es solo agrupación UI).
- `ArticuloPicker` sigue existiendo para pedir/conteo (no tocados).

**Fase 2 — Reporte semanal plantilla v2 (PROMPT-3):** backend ya tiene `REPORTE-SEMANAL-V2` activa (9 ítems oficiales del papel) y V1 desactivada; el wizard la consume dinámicamente. Se **quitó el selector de combustible** (no estaba en prod; §B lo pide); km se mantiene; ítem 10 = comentario opcional (campo observación). La confirmación refleja hallazgos si hubo algún "NO".

**Pendiente:** device-QA del flujo de hojas (multi-categoría, editar en resumen, compartir con/sin share nativo, offline) + reporte semanal v2. Bump/APK. Commit/push cuando lo apruebes.

---


## Mejoras 14/07/2026 (reunión jefe — R1–R29) — build green, 17/17 tests, backend aplicado 🚧 falta device-QA
Implementadas 8 fases sobre Flota v2. `npm run build` limpio y `ng test` 17/17. Migraciones aplicadas a la BD prod compartida (`node scripts/apply-migration.mjs`).

**Backend nuevo aplicado desde este repo (`sql/`):**
- `2026-07-14-crear-ruta-app.sql` — RPC `crear_ruta_app` (idempotente, gate flota, homologa origen/destino).
- `2026-07-14-reportes-fotos.sql` — bucket `reportes` (+RLS), tabla `reportes_usuario_fotos`, `crear_reporte_app` extendido con `p_fotos` (se dropeó la sobrecarga vieja de 4 args para evitar ambigüedad PostgREST).
- `2026-07-14-bitacora-clima-migracion.sql` — `crear_bitacora_app` extendido con `p_llovio/p_lluvia_detalle/p_hubo_migracion/p_migracion_obreros` + inserta `cantidad` de actividades. Retrocompatible (params con default).
- (PROMPT-1 ya estaba: `vehiculo_asignaciones`, `asignarme_vehiculo`, `auto_registrar_conductor`, plantilla `REPORTE-SEMANAL-V1`, vistas `v_vehiculo_stats`/`v_conductor_stats`/`v_reporte_semanal_cumplimiento`, `categorias_inventario.destacada`, `articulos.categoria_id`, `proyecto_partidas`, `app_versiones`+`version_publicada()`, triggers de homologación.)

**App (por fase):**
- **F1 (R1/R2/R11):** Transporte con `EmptyState` + CTA "Asignarme un vehículo"; wizard `transporte/asignar` (lista disponibles → auto-registro conductor si falta → `asignarme_vehiculo` → encadena a recibimiento). "Asignados a mí" lee `vehiculo_asignaciones`. Nuevo `shared/ui/empty-state`.
- **F2 (R3):** `transporte/reporte-semanal` (plantilla semanal, OK/NO/NA + combustible + km + obs; badge de pendientes; "ya enviaste esta semana"). `ReporteSemanalService` → `registrar_checklist_vehiculo` (tipo `inspeccion`, la vista detecta por `frecuencia='semanal'`).
- **F3 (R7):** `transporte/rutas/crear` (espeja creación web de rutas; offline outbox `crear_ruta`). Combustible v2 verificado operativo.
- **F4 (R10):** `@aparajita/capacitor-biometric-auth@10` (Cap 8). `BiometricService`, toggle en Perfil (solo si soporta, oculto en PWA), botón "Usar huella" en pin-unlock; PIN sigue siendo fallback. `npx cap sync android` hecho.
- **F5 (R11/R13/R14):** `EmptyState` en Mis conduces/Mis bitácoras/Mis requisiciones/Recibir/Home-sin-módulos. Bitácora parte: topbar ← + Cancelar + confirmación de salida. Reportar: fotos (`PhotoSlot`→bucket `reportes`). ⚠️ **falta que la web SGC muestre las fotos de reportes** (rule #5).
- **F6 (R12/R16/R17/R18):** `ArticuloPicker` por categorías (destacadas primero, fallback plano en pedir/conteo); stepper −/+ en salida/entrada; `inventario/almacenes` (CRUD, gate inventario); homologación front (`core/util/texto.ts`) + trigger BD.
- **F7 (R21–R24):** wizard bitácora reordenado a 8 pasos (obra→lluvia→migración→personal→actividades c/cantidad+plan→problemas→fotos→resumen); incidente descripción obligatoria.
- **F8 (R4/R5/R15/R26):** `transporte/vehiculo/:id` (v_vehiculo_stats) y `transporte/mi-actividad` (v_conductor_stats); `VersionService` + gate bloqueante si local<mínima + aviso versión nueva + Perfil muestra versión publicada; home ya gatea tiles por módulo (R26).

**Pendiente (necesita Xaviel / no automatizable):**
- Device-QA: auto-asignación→auto-registro→recibimiento, reporte semanal, crear ruta, biometría+fallback PIN, bitácora atrás+lluvia/migración/cantidades, reporte con fotos, inventario por categorías+stepper, gestión almacenes, gate de versión. Offline→reconnect en los flujos nuevos.
- **SGC web:** mostrar fotos de reportes de usuario (R14) y verificar que renderiza lluvia/migración/cantidades/incidente_descripcion (R21–R24). Marcar `categorias_inventario.destacada` para Clavos/Madera (hoy solo Acero) — §5 pendiente de confirmar.
- Bump de versión + build/firmar APK + publicar (`scripts/build-apk.md`, `release-apk.mjs`); `npx cap sync android` antes de compilar. No se hizo commit/push.

---


_Last updated: 2026-07-13 (Flota v2 — Combustible + Pre-uso v2)_

## Flota v2 — Combustible (nuevo) + Pre-uso v2 (branch `fix/mobile-responsive`) — build green, APK on device 🚧 falta walk-through con login
Backend Fase 0 ya estaba aplicado en `sgc` (verificado contra la BD, no re-hecho): RPC `registrar_combustible_app` (jsonb con derivados), `registrar_checklist_vehiculo` extendido con `p_nivel_combustible` (calcula `resultado`/`alerta_mantenimiento`/bloqueos server-side), columnas nuevas en `vehiculos`/`conductores`/`registros_combustible`/`checklists_vehiculo`, tabla `avisos_flota`, catálogo v2 (plantilla `PRE-USO-V2`, 33 ítems, `numero`/`aplica_a`/`es_critico`), `flota_config` (umbral_consumo_pct=20, umbral_precita_km=500, umbral_licencia_dias=30).

**FASE 1 — Combustible** (`pages/transporte/combustible/:vehiculoId`, botón ⛽ en el hub):
- `core/models/combustible.model.ts` (`calcularCombustible()` — espejo exacto del RPC), `core/services/combustible.service.ts` (`getUltimaEchada()` cacheado por vehículo + `registrar()` → outbox `tipo_op:'combustible'` → handler sube 2 fotos a `vehiculos` en `combustible/{uuid}/{recibo|tablero}.jpg`, upsert idempotente, RPC con paths).
- Wizard 3 pantallas: datos (km valida >última echada, galones, monto, estación) + caja oscura de cálculo en vivo → 2 fotos obligatorias ("Faltan fotos para guardar") → confirmación "Combustible registrado" con tarjetas + banda verde/ámbar (offline: cálculo local + "se validará al sincronizar").

**FASE 2 — Pre-uso v2** (reescrito `pages/transporte/preuso/`):
- `ConductoresService` nuevo (`getMiConductor()` por `usuario_id=auth.uid()`, cacheado) + `conductor.model.ts` (`estadoLicencia`). `VehiculosService.getVehiculoDetalle()` (vencimientos + km mantenimiento, cacheado).
- Bloqueos previos: licencia vencida / matrícula / seguro vencidos → pantalla de bloqueo; licencia ≤30 días → banner. **Ahora envía `p_conductor_id` real** (antes null).
- Pasos: datos de salida (km valida ≥ odómetro + nivel combustible + línea de mantenimiento en vivo ok/pre-cita/vencido) → checklist v2 (ítems por `aplica_a`, "Herramienta Pesado" solo si `tipo` es pesado — pickup=liviano, oculta; críticos "CRÍTICO · BLOQUEA"; barra semáforo n/total) → 7 fotos guiadas (slots `delantera,lateral_izq,lateral_der,trasera,tablero,interior_del,parte_trasera`) → firma → veredicto tri-estado.
- **PDF + compartir**: `PreusoReportService` (jsPDF — header oscuro, datos, banda de resultado, hallazgos, página de evidencia) → `@capacitor/share` nativo (Filesystem cache) / Web Share API en PWA / fallback descarga.
- Deps nuevas: `jspdf@4`, `@capacitor/share@8` (`npx cap sync android` hecho — Share registrado). `angular.json`: `allowedCommonJsDependencies` (jspdf/canvg/core-js/raf/rgbcolor).

**Verificación:**
- `npm run build` limpio (0 errores/0 warnings). 17 tests verdes (`core/models/flota-calculos.spec.ts`: cálculo combustible, licencia, pesado/aplicabilidad).
- Web SGC (`dev/SGC`) **ya tiene** todo el lado de visualización y **lee exactamente lo que la app escribe** (verificado column/path/slot): `/flota/combustible` (echadas), `/flota/combustible-dashboard` (acumulado + panel flotilla), `/flota/checklists` (inspecciones con resultado/7 fotos/hallazgos), `/flota/panel-dia`, `/flota/avisos` (gestión avisos_flota). Nada que construir en web.
- **APK debug instalado en device `6dbf1af4` (Redmi Note 10)** y arranca OK (login renderiza, sin crash). ⚠️ Se desinstaló la app de producción (firma release ≠ debug keystore; autorizado por Xaviel) — la sesión/PIN/cola offline previas se perdieron. Para volver a producción: reinstalar desde la página de descarga.

**Datos de prueba configurados (BD prod compartida):** `TEST-0000` → `responsable_id`=Xaviel (aparece en "Por recibir"), matrícula/seguro=2026-12-31 (vigentes), `km_ultimo_mantenimiento`=6000, intervalo=5000, odómetro=10000 (a 10.000 faltan 1.000=normal; teclear ~10.600→pre-cita, ~11.200→vencido). Conductor "TEST Conductor Prueba" ligado a `tecnologia@` (licencia vigente 2027-09-16, Ambos). El vehículo real `AB2890340` NO se tocó.

**Pendiente (necesita Xaviel — no automatizable):** walk-through en el teléfono con tu contraseña + PIN + cámara: combustible (primera echada / normal / km inválido), pre-uso (aprobado/hallazgos/bloqueado, pre-cita), PDF compartir, offline→reconnect. Luego confirmar en la web (`/flota/*`). Para probar bloqueo por licencia/matrícula: poner una fecha pasada en el conductor/vehículo de prueba. **No se hizo commit/push** (a la espera de tu OK).

---

_Last updated: 2026-07-12 (v1.2.0)_

## v1.2.0 — mantenimiento + rutas "cómo llegar" (para el piloto)
- **Reportar mantenimiento** (Transporte → por vehículo): tipo/descr/km/fotos, offline-outbox → RPC `crear_mantenimiento_app` (idempotente). Servicio `core/services/mantenimientos.service.ts` (registrado en app.config), página `pages/transporte/mantenimiento/:vehiculoId`.
- **Rutas de hoy → "Cómo llegar"**: abre la app de mapas del teléfono al destino.
- (Parte B previa: renames Requisición/Almacén + checklist pre-uso, ya en prod.)
- Bump **v1.2.0 / versionCode 11**. APK firmado se construye con `scripts/build-apk.md` (JAVA_HOME=Android Studio jbr, `./gradlew.bat assembleRelease`), `adb install -r`, y `node scripts/release-apk.mjs` publica APK+version.json al bucket app-releases.


## Reunión 07/07/2026 — Parte B (branch `feat/meet-07072026`, build green) 🚧 pendiente device-QA + publish
Mobile side of the 07/07 meeting. DB is shared with SGC web; RPCs already exist there.
- **Renombres UI** (solo labels): "Solicitudes/Pedir materiales" → **Requisición/Nueva requisición** (home tile, hub, pedir, mis); "Bodega" → **Almacén** (existencias/salida/entrada/conteo). Estados de requisición SIN cambio (la app ya conoce pendiente/aprobada/entregada/rechazada; NO exponer compras/montos al chofer).
- **Checklist de pre-uso vehicular** (nuevo): `pages/transporte/preuso/:vehiculoId` — wizard plantilla → ítems OK/Falla/N-A por sección (marca crítico + foto en NO) → km/obs → firma → resumen. Servicio `checklist-preuso.service` mirror de `vehiculos.service` (outbox offline, idempotente por UUID) → RPC `registrar_checklist_vehiculo` (ya existe en `sgc`). Handler registrado en `app.config`. Botón en el hub de Transporte.
- **NO** se agregó nada de cuadres/límites/alertas/montos ni Tecnología/Expediente (prohibido para campo).
- **Pendiente:** device-QA (offline + online), y **bump de versión + build/publish del APK** (paso de Xaviel — requiere dispositivo). No se subió versión aún.

_Last updated: 2026-07-11 (below)_

## v1.1.3 — interactive spotlight tour (both systems), device-verified + published ✅
The first-run guide now **shows** instead of only telling: it dims the screen and spotlights each real UI element as it explains it.
- **Web (SGC)**: `onboarding-web` rewritten as a tour — welcome → sidebar → pending badges → CSD App link → Soporte → profile → done. Anchored via `data-tour` attrs + `tourKey()` in the shell. Replayable from Soporte ("Ver la guía de bienvenida"). Browser-verified (rings the real sidebar / each nav item; centered fallback when a target is absent).
- **App (CSD)**: `shared/components/onboarding` rewritten as a spotlight tour on Home — welcome → tiles → sync bar (verde/amarillo) → profile → done. Anchored via `data-tour` on the grid, `<app-sync-bar>`, and the Perfil button. Replay from "Soporte y ayuda". **Device-verified** end-to-end (v1.1.3): each element ringed in orange, callout positioned above/below, dismisses clean.
- Same spotlight technique both sides (box-shadow dim + measured getBoundingClientRect + on-resize re-measure). **Published v1.1.3** (code 10).


## v1.1.2 round — skeletons, sign-out confirm, full audit trail (both systems) ✅
- **Audit trail (traceability)** — `sql/2026-07-11-auditoria.sql`: `sgc.auditoria` + a generic `fn_auditoria()` AFTER trigger attached to **55 business tables**. Captures every INSERT/UPDATE/DELETE with the real actor (`auth.uid()`), a before→after diff (UPDATE), and the row (INSERT/DELETE). DB-level ⇒ catches **web AND app** writes automatically (app RPCs are SECURITY DEFINER but keep the caller's JWT). RLS: readable by `is_admin() or tiene_modulo('auditoria')`. `auditoria_actores()` RPC feeds the user filter. Verified non-destructively (trigger logs exact diff + actor, rolls back).
  - **Web viewer**: SGC Admin → Auditoría (`pages/admin/auditoria`, `auditoria.service`) — filter by usuario/área/acción/fecha + search, server-side `.range()` pagination, expandable diffs. Device/browser-verified.
  - **App viewer**: CSD Admin → Auditoría (`pages/admin/auditoria`, `AdminService.getAuditoria`) — filter chips + load-more + expandable diffs. Device-verified (caught a real "Modificó Catálogo · Activo Sí→No" by Xaviel).
- **Skeleton loaders** — SGC `shared/components/skeleton` (table/list/cards) on 8 main list pages; CSD `shared/ui/skeleton` on all data screens (transporte, conduces, existencias, conteo, recibir, mis-solicitudes, mis-partes, detalle, admin/*). Replaces blank pages / bare "Cargando…".
- **Sign-out confirmation** — SGC `shared/components/confirm-dialog` on the header logout; CSD `shared/ui/confirm-dialog` on Perfil → Cerrar sesión. Both device/browser-verified.
- **Published**: versionCode 9 / **v1.1.2**. Both repos pushed; SGC → Vercel.
- Note: audit `sgc.auditoria` starts empty and fills with real activity going forward (synthetic demo rows were purged).


## Web parity round — conduce evidence tested + all app media now visible in web ✅
Rule reinforced: the app is a **child of the web** — anything captured on the app must be viewable in SGC. Audited every app write; closed the media gaps. All verified in a real browser (Edge headless, session minted via admin magic-link OTP + localStorage injection against the SGC dev server):
- **Conduce delivery evidence** — seeded real photo+firma into the `conduces` bucket, confirmed the SGC conduce view renders "Recibido en obra por / Entrega registrada por {chofer}" + the delivery photo & signature. Test data reverted.
- **Web first-run guide** — `SGC/src/shared/components/onboarding-web` (5 slides, skippable "Saltar guía"). Shows once for **non-admin** users on first shell load; **admins skipped** (marked done silently). Flag `sgc_onboarding_v1_done` in localStorage. Verified showing+dismissing for non-admin "Test User 3".
- **Vehicle signature** (`vehiculo_entregas.firma_url`, bucket `vehiculos`) — now signed+rendered in Flota → Responsabilidad. (No prod rows yet to screenshot; compiled + same pattern as the 6 photos already shown.)
- **Bitácora media** — historial detail now renders field photos inline (thumbnails) and incident voice notes with an `<audio>` player (were text links). Verified: 2 inline photos + audio player.
- **Inventario salida/entrada photo** (`foto_path`, bucket `inventario`) — salida capture photo added to the conduce view; entradas list gains a Foto column with a 📷 button (signed URL). Verified entrada foto button.
- Testing note: `msedge` + `playwright-core` + `admin.generateLink({type:'magiclink'})`→`verifyOtp`→inject `sb-<ref>-auth-token` is a repeatable way to screenshot authed SGC pages headlessly. Installed/removed per-test; not committed.


## v1.1.1 round — portrait lock, onboarding, conduce evidence in web (device-verified) ✅
- **Portrait lock**: `MainActivity android:screenOrientation="portrait"` — fixes the landscape PIN-pad overflow (keys 7/8/9/0 off-screen). Verified on device.
- **First-run onboarding**: `shared/components/onboarding` — 4 skippable full-screen slides (sin señal / fotos+firma / barra de estado) shown once on Home; flag `csd_onboarding_v1_done` in LocalStore. "Ver tutorial de nuevo" button in Soporte replays it. Device-verified end-to-end (slides → Empezar → dismiss → stays dismissed).
- **On-device smoke test** (v1.1.x, device 6dbf1af4): Admin hub (4 tiles) ✓, Catálogos add+desactivar against live DB ✓, Perfil (Admin badge) ✓, Soporte FAQ ✓.
- **SGC web gap closed** (keep-both-in-sync): the app closes conduces with a delivery photo + receiver + signature via `sgc.entregar_conduce`. The web conduce view (`pages/inventario/conduce`) now shows *Recibido en obra por*, *Entrega registrada … por {chofer}*, and renders the delivery photo + signature via signed URLs from the private `conduces` bucket. Model + `salidas.service` SELECT extended with `entregado:usuarios!..entregado_por_fkey(nombre)`. Committed+pushed to SGC `main` (Vercel auto-deploy).
- **Published**: versionCode 8 / **v1.1.1** built, signed, uploaded to `app-releases` (apk + latest + version.json). csd-app `main` pushed.


## Where we are
**M1 (Fundaciones) DONE. M2 (Transporte) — vehicle-responsibility checklist DONE.** Build passes (156 kB initial transfer). Pushed to `origin/main`.

M2 backend applied to prod + verified non-destructively (RPC enforces auth, `flota` module, the 6 required photos, and the "one responsible" rule; happy path inserts custody + updates vehicle; rolled-back test left 0 rows):
- `sgc.vehiculo_entregas` / `_fotos` / `_danos` (append-only, RLS read-only, unique-partial index)
- RPCs `crear_entrega_vehiculo` (idempotent), `vehiculo_estado_actual`, `mis_pendientes_transporte`
- Storage buckets `vehiculos`, `conduces`
Frontend: Transporte hub (a cargo / por recibir) + 6-step checklist wizard (6 guided photos → km+combustible → daños → firma → resumen), enqueued offline via the `vehiculo_entrega` sync handler (registered at bootstrap).

## Done
- **Scaffold**: Angular 21 (standalone, zoneless) + Capacitor 8 + Angular PWA (service worker + manifest). Android platform added under `android/`.
- **Env**: `src/environments/*` point at the SGC Supabase project (same anon key). Prod file-replacement wired in `angular.json`. Secrets in gitignored `.env.local`.
- **Design system** (`shared/ui`): big-button, option-button, counter, photo-slot (Capacitor camera + web fallback, JPEG compression), step-bar, big-confirm (haptic), signature-pad, sync-badge, pin-pad. Tokens in `styles.scss` (UI/UX doc).
- **Core**: SupabaseService (Preferences-backed session on native), AuthService, PinService (PBKDF2 hash, 5-try lockout), LocalStore, UserContextService (roles→módulos, mirrors SGC), SessionService (boot flow), NetworkService (signal), CameraService, ToastService.
- **Offline engine**: Dexie DB (`core/db/app-db.ts`), CatalogService (read-through cache + storage.persist), SyncService (outbox FIFO, photo→RPC, backoff 30s→5min×6, pending/syncing/done/error, client-UUID idempotency, handler registry).
- **Guards**: authGuard → pinGuard → moduleGuard.
- **Pages**: login, reset, set-password, pin-setup, pin-unlock, home (4 tiles gated by módulos, single-módulo auto-enter), module placeholders (bitácora/transporte/inventario/solicitudes), 403. Global SyncBar + ToastHost.

## Migrations — SOLVED
DDL works via the Management API using the system env var `SUPABASE_ACCESS_TOKEN` (sbp_…, already set on this machine). Use `node scripts/apply-migration.mjs sql/<file>.sql` — runs as postgres. `v_app_mi_contexto` view applied + verified on 2026-07-08. This is the path for M2's `vehiculo_entregas` tables + RPCs.

## Blockers / needs Xavier
1. **Live login walk-through** — needs a real SGC user's password to test login→PIN→home end-to-end. Build/serve/data-shape all verified; the interactive auth path is the one thing I can't self-test.
2. **Android APK** — no JDK/Android SDK on this machine. `android/` project is ready; installing JDK 21 + Android Studio lets us build/sign the first APK + keystore.
3. **Rotate keys** — service_role/secret + other keys passed through chat; rotate after the milestone.

## SGC web — Flota "Responsabilidad" view DONE (needs your commit/push)
Added in `dev/SGC` (builds clean): route `/flota/responsabilidad`, shell nav entry, `VehiculosService.getResponsabilidad()` + `getEntregaFotoUrl()`, and the `Responsabilidad` component (history list, "requieren revisión" filter, expandable photos/signature via signed URLs, damage highlighting). **Not committed** — SGC pushes deploy to Vercel prod, so left for you to review + push.

## M2 conduces — DONE
- Migration `2026-07-08e-conduces.sql` applied: `conductores.usuario_id` FK; delivery-evidence columns on `salidas_inventario`; RPCs `entregar_conduce` (idempotent, reuses despachado→entregado/incompleto), `mis_conduces_hoy`, `mis_rutas_hoy`, `marcar_ruta_estado`. Guard paths verified.
- App: `ConducesService` (+ `conduce_entrega` sync handler, registered at bootstrap); Transporte hub → "Mis conduces y rutas" → conduces list (routes with iniciar/completar + conduces) → delivery flow (photo → ¿llegó todo? → partial qty → receiver + signature), offline-first.
- SGC web (`dev/SGC`, uncommitted): Conductores form now links a driver to an app user (`usuario_id`) so `mis_conduces_hoy`/`mis_rutas_hoy` resolve. Builds clean.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes for both M2 features (Flota "Responsabilidad" view + Conductores user-link):
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## Still needs Xavier
1. Live walk-throughs (need a real user password): vehicle checklist + conduce delivery, offline→reconnect→verify in Supabase. For conduces, first link a conductor to a user in SGC and dispatch a salida.
2. Real notifications on `requiere_revision` (no `sgc.notificaciones` table found — locate SGC's mechanism).

## M3 — Bitácora DONE
- Migration `2026-07-08f`: idempotent `sgc.crear_bitacora_app(p_id, …)` (module gate, actividades/restricciones/fotos, usuario_id = auth.uid()). Verified non-destructively (parte_diario inserts header + child rows; module gate rejects non-bitacora users). Photos reuse the existing `sgc-bitacora` bucket. Catalog enums pulled from the real CHECK constraints (estructuras/actividades/restricciones).
- App: `BitacoraService` (+ `bitacora` sync handler at bootstrap); Bitácora hub → parte-diario wizard (obra → personal counters → actividades → problemas → fotos → resumen), incidente short flow (tipo → gravedad → heridos → fotos → nota), and offline "Mis partes" list.

## M4 — Inventario + Solicitudes DONE
- Migration `2026-07-08g`: idempotent app RPCs `registrar_salida_app` (validates stock, fires trg_detalle_salidas_stock), `registrar_entrada_app` (fires detalle_entradas_stock_trigger), `crear_solicitud_app`; `foto_path` columns + `inventario` bucket. Verified non-destructively (entrada bumps stock, solicitud creates pendiente/urgente, salida guard rejects over-stock, 0 rows left).
- App: `InventarioService` + `SolicitudesService` (handlers at bootstrap). Inventario hub → existencias (bodega + search), salida (cart + optional photo), entrada (cart + referencia + photo). Solicitudes hub → pedir (cart + urgencia) + mis solicitudes (status list).

## Milestone status — all feature milestones built
M1 ✅ · M2 ✅ · M3 ✅ · M4 ✅. M5 is piloto/rollout (no app code). The 4 Home modules are all functional end-to-end offline.

## PWA — DEPLOYED ✅
Live at **https://app.sgcconstructorasd.com** (Vercel project `csd-app`, team CSD; GitHub repo connected → push to `main` auto-deploys). `vercel.json` = SPA rewrites + `no-cache` on ngsw-worker.js/ngsw.json/index.html. Verified live: deep-link routes 200, SW no-cache. PWA auto-update wired (UpdateService: VERSION_READY → activate + reload). Perfil screen shows app version (1.0.0) + manual "Buscar actualización" + logout.

## Signed APK — BUILT & PUBLISHED ✅
Android Studio (JDK 21 + SDK) is installed, so the APK builds locally. Release
keystore `android/csd-release.keystore` + `android/keystore.properties`
(gitignored — **BACK THESE UP**; losing them = users reinstall). Signed
`app-release.apk` (7.4 MB, V2-signed) published to the public `app-releases`
bucket + `version.json`. Build/release steps: `scripts/build-apk.md`,
`scripts/release-apk.mjs`. SGC page **CSD App (móvil)** shows APK link + QR + PWA
install. Rebuild: `npx cap sync android && cd android && ./gradlew assembleRelease`
(set JAVA_HOME + ANDROID_HOME per build-apk.md).

## Authenticated E2E — VERIFIED ✅
Real anon-key sign-in → JWT → v_app_mi_contexto (módulos) + mis_pendientes_transporte
+ stock reads all work under RLS (throwaway user, deleted after). Only the on-device
camera/airplane-mode UI walkthrough still needs a physical phone.

## Done this round
Recepción de conduce en bodega (recibir_conduce_app), voice notes (incidente),
offline drafts (parte), solicitud email notification (badge interconnection is
automatic). SGC Flota view + conductor link + APK download page pushed to prod.

## v1.0.1 UX round (device-verified) ✅
Custom CSD icon (adaptive), redesigned PIN pad (device screenshot confirms), "parte"→"bitácora" copy, Mis bitácoras server list + detail (fotos/audio signed URLs), actividades multi-select (estructura×actividad), incidente obra selector fixed + voice note, browsable **ArticuloPicker** (select instead of search) in pedir/salida/entrada, entrada "Referencia"→"¿De dónde viene?" chips, `replaceUrl` on finish (back no longer re-enters filled wizard). v1.0.1/code 2 built, published, installed on device 6dbf1af4.

**Play Protect:** the "unknown developer" prompt is inherent to sideloading (targetSdk 36, signed, minimal perms — already optimal). "Install anyway" is expected/safe; only Play/Managed Google Play removes it.

**On-device deep test blocked on the local PIN** — give me the 4-digit PIN (or a test user's password) and I can drive the full flow via adb + screenshots to hunt bugs. Role gating is verified: Home tiles + routes are filtered by roles.modulos (a chofer sees only Transporte; an all-módulos user sees all — that's correct).

## Done (v1.0.3)
- **Conteo rápido**: `conteos_inventario`/`conteo_items` audit tables + idempotent
  `registrar_conteo_app` (adjusts stock to counted value via adjust_stock). Inventario flow.
- **Incident email alerts**: `notificar-incidente` edge function (deployed) → admin + proyectos
  module holders; app invokes it on incident sync. No-ops if Resend key unset.
- On-device walkthrough done (see v1.0.1/1.0.2 notes); PIN re-lock on resume fixed.

## v1.0.4 (this round)
- **Keystore backed up** to `Projects documentations/CSD App Documentation/KEYSTORE-BACKUP/` (+ LEEME.txt). ⚠️ Still copy it OFF this machine (password manager / cloud / USB).
- **Incident emails enabled/confirmed**: Vault Resend key present, function deployed, recipients = 1 admin + 5 proyectos. Fires on the first real field incident (didn't send a fake test blast).
- **UX**: native obra/bodega dropdowns → tappable `SelectList` (glove-friendly) across pedir/salida/entrada/conteo/existencias.
- **Security**: deactivated-user lockout (cold start + resume). FLAG_SECURE deliberately skipped (would block WhatsApp screenshot-sharing).

## Airplane-mode test — PASSED ✅ (on device 6dbf1af4, v1.0.4)
Offline→reconnect→sync verified end-to-end: cut wifi/data → app showed "Sin señal" →
created a solicitud offline (amber "Guardado · Se enviará solo") → outbox tracked
"1 se enviarán solos" → reconnected → auto-synced ("Todo enviado") → real row landed
in sgc.solicitudes_material (BRISAS CITY CENTER, Xaviel Terrero, pendiente). Interconnection
confirmed (shows in SGC Solicitudes + badge). Offline-first promise proven on a real phone.

## v1.0.5 round (units, incidents, feedback)
- **Units are now admin-managed** (SGC): `sgc.unidades` catalog (seeded from the old hardcoded list) + **Administración → Unidades** (create/rename/activate). The artículo form reads units from the DB. App shows units from the artículo (no app change needed).
- **Incident emails retargeted**: now go to the incident PROJECT's team (proyecto_empleados→empleados→usuarios) + admins, not all PMs company-wide. Redeployed.
- **In-app "Reportar un problema"** (Perfil → SGC reportes_usuario → Administración → Comentarios y Reportes). RLS insert verified.
- v1.0.5 built + published to the download page. ⚠️ Device was unplugged at the end — reinstall to the phone via the download page (or `adb install -r` when reconnected). App was fully on-device tested in prior rounds; this round verified via RLS tests + builds.

## v1.1.0 round — app is a fuller "child of the web"
- **App Admin section** (gated by `admin` module, Home tile + Perfil): Reportes (view/resolve),
  Catálogos de bitácora, Unidades, Historial de conteos. RLS-gated server-side (is_admin).
- **App Soporte/Ayuda** page (FAQ + reportar), linked from Perfil.
- **Bitácora catalogs now admin-managed** (`sgc.bitacora_catalogos`; CHECKs dropped). Both the app
  wizard and the SGC nueva-bitácora form load them from the DB (built-in lists = offline fallback).
  Manage in: app Admin → Catálogos, or SGC Administración → Catálogos de bitácora.
- **Conteo/ajuste history**: app Admin → Historial de conteos, and SGC Inventario → Conteos y ajustes.
- v1.1.0 built + published. ⚠️ Device was offline — reinstall via the download page or adb when reconnected.

## Remaining (needs you / optional)
- **Rotate Supabase service_role/secret keys** (dashboard — they passed through chat).
- **Back up the keystore** (`android/csd-release.keystore` + `keystore.properties`).
- Airplane-mode capture→reconnect→sync test on a real device (camera + offline queue).
- Optional: notificar-incidente recipients (currently admin+proyectos) — tune if you want
  project-specific supervisors; set NOTIFICATIONS_FROM_EMAIL + Resend key in Vault to enable email.

## SGC web pending YOUR commit/push (deploys to Vercel prod)
`dev/SGC` has uncommitted changes: Flota "Responsabilidad" view (M2) + Conductores user-link (conduces).
`git -C "C:/Users/xavie/Desktop/X Dev/dev/SGC" status`

## How to run
```
cd "C:/Users/xavie/Desktop/X Dev/dev2/csd-app"
npm start            # PWA at http://localhost:4200
npm run build        # prod build check
```
