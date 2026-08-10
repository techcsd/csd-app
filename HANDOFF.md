# HANDOFF — CSD App

## 🟠 SESIÓN 10/08 (tarde) — PROMPT-2 ronda AK (7 fases) — **BUILD VERDE, SIN COMMIT/PUSH/APK aún**
Depende de PROMPT-1 (SGC v1.70.0, migraciones AK en prod). `npm run build` **exit 0**. **NO** se ha hecho commit/push/deploy ni APK (esperando OK de Xaviel). **1 migración aditiva aplicada a prod:** `SGC/sql/2026-08-10-ak22-mis-rutas-hoy-creado.sql` (añade `creado_en` a `mis_rutas_hoy`; retrocompatible).

- **FASE 1 (AK12/9/3/11/7/22):** arranque SIEMPRE en Home (se eliminó el auto-entrar mono-módulo en `home.ts` que abría Transporte al chofer en cada arranque; +limpieza `session.service`). Back del wizard de conduce → `conduces-hub` vía `navGuard.back` (antes iba a `/transporte/conduces` = Mis rutas). Empty state de Mis rutas ahora habla de RUTAS. Renombres: "Marcar entrega"→"Gestionar entrega", "Iniciar tránsito"→"Iniciar ruta" (+"En ruta" en estados/historial), "Estoy entregando" abre DIRECTO el proceso de entrega. Fecha+hora 12h de emisión (conduce) y de planificación (ruta) en las tarjetas.
- **FASE 2 (AK6):** raíz encontrada — `CollapsibleSelect` NO era cerrado por defecto (mostraba la lista inline hasta elegir). Ahora es un dropdown de verdad (trigger cerrado → abre al tap → colapsa con selección + Cambiar) → arregla TODOS los selectores del wizard de conduce de un golpe. `vehiculo-picker` tiene modo `dropdown`; los selectores de vehículo (combustible/aviso/multa/rutas) ya eran gate-screens/hojas que colapsan. Conductor de crear-ruta migrado a dropdown. Despachantes: filtro server-side (AJ6) verificado — Eduardo NG probablemente sale por rol `gerente_produccion` (obra, elegible); si es pura oficina, es dato/config (ver pendientes).
- **FASE 3 (AK8/1/4):** menú de Conduce depurado (fuera Recibir / Por firmar / Devolver a suplidor / Compra en ferretería; **rutas conservadas** para no romper deep-links). Nueva vista **Confirmaciones** (`/transporte/confirmaciones`, RPC `confirmaciones_historial`/`confirmacion_detalle`, con detalle: items pedido/recibido, quién entregó/confirmó, fotos, firmas). Badge "por confirmar" ya consume la matriz nueva server-side (sin cambio app).
- **FASE 4 (AK14/15/20/19):** modelo "en uso/libre". Nueva pantalla **Uso de vehículo v2** (`/transporte/uso-vehiculo[/:id]`): nivel de gasolina (E,1/4,1/2,3/4,F), inicia sesión / **recibe de X** (DR409) / **suelta**. Card del hub: "En uso" con Soltar; "Para usar" reemplaza "Por recibir"; fuera "Asignados a mí", "Recibir vehículo", "Checklist de pre-uso", "Asignarme". `VehiculoUsoService` nuevo. Mi actividad desbloqueada con `es_conductor_ampliado` (arregla a Papo). (`asignarme`/`preuso` quedan solo por ruta/deep-link.)
- **FASE 5 (AK16/17/18):** **Multas** endurecidas app-side: chofer→conductor preseleccionado y **bloqueado** (sin selector); elevado→`conductores_para_multa()` (incluye a Papo); gating por `puede_multar_a_otros()`. **Aviso de vehículo**: nota de **voz** (voice-notes AH13, entidad `aviso_flota`) + **video** (input cámara, bucket vehiculos, `p_videos`) + pestaña **"Mis reportes"** (`mis_novedades_reportadas`, con estado). **Historiales**: "Mis usos de vehículo" (sesiones `mis_usos_vehiculo`) en Mi actividad.
- **FASE 6 (AK10/2/5):** **Alarma dominical** in-app tipo despertador (`AlarmaService`+`AlarmaHost`, overlay full-screen + beep Web Audio + vibración): dispara con la push `alarma-reporte-semanal` en primer plano y al abrir en domingo con reporte pendiente; botones "Hacer reporte ahora"/"Posponer 1h". **Layout**: `module-order.service` ahora soporta `scope` (get/set_module_order p_scope), home/transporte intactos. **Proyectos**: arreglado el back invisible de `cronograma-avisos`.
- **FASE 7 (AK13):** app-side — permiso `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` en el manifest + aviso una-vez al iniciar ruta (instrucciones de exclusión de batería MIUI). Pipeline (foreground service + ruta_id + outbox + `registrar_posiciones`) ya estaba; server con guard ampliado + diagnóstico.

### ⚠️ Pendientes de Xaviel (PROMPT-2 AK)
- **Shipping:** decidir commit/push (PWA) + `npm run apk`/`apk:publish` + flip `publicada`. NO se hizo automáticamente.
- **AK13 validación OBLIGATORIA:** conducir un trayecto real con el user-test y confirmar en Seguimiento (vivo + breadcrumb). Es físico/dispositivo. Si MIUI mata el servicio, excluir batería con las instrucciones del aviso.
- **AK21 (registro de echadas):** BLOQUEADO — la nota llegó cortada; no se tocó.
- **Confirmar textos/valores asumidos:** AK11 "Gestionar entrega"; escala gasolina E,1/4,1/2,3/4,F; AK10 posponer 1h; matrices AK4/AK16/AK17/AK18 (defaults server aplicados); límite video 60s (hoy no forzado client-side).
- **Parciales (follow-up):** (a) AK2 — botón "Ordenar y redimensionar módulos" solo en home+transporte; el servicio ya soporta scope, falta el modo edición en el resto de módulos/submódulos; (b) AK16 — la bandeja de gestión in-app (`/transporte/avisos`) aún no muestra voz/video en el detalle (la web sí); (c) AK18 — el historial de elevados sigue con el RPC viejo (`getChecklistsHistorial`), no el nuevo `historial_checklists_vehiculo` con filtro usos; (d) AK5 — Proyectos usa tarjetas oscuras (#161616) sobre tema claro (inconsistencia de diseño): NO convertidas (cambio mayor, a decidir con Xaviel); (e) AK16 alarma full-screen con app CERRADA necesita plugin nativo (hoy es in-app/al abrir).
- **Despachante AK6:** si Eduardo NG (u otra gente de oficina) sigue saliendo mal, revisar sus roles en SGC (o `puede_despachar`); el filtro server ya está.

## 🟢 SESIÓN 10/08 — PROMPT-15 AJ15 (auditoría QA completa) — **RELEASE 1.69.0 PUBLICADO (rolling)**
Auditoría a nivel de código de toda la app (108 páginas) con 6 auditores paralelos → **`INFORME-AUDITORIA-APP.md`** (44 hallazgos QA-1..QA-44, priorizados, con evidencia `archivo:línea` y estado final en §9). **Se resolvió todo el backlog** a pedido de Xaviel: ~35 corregidos, 6 verificados como ya-correctos en backend (no eran bugs), 3 aceptados/diferidos, 1 pendiente de decisión de producto (QA-42 término "pre-uso"). `npm run build` **VERDE**. Commits: **`c9b40ea`** (TOP-3 + informe + UI), **`9e10db0`** (backlog QA-6..44), **`9395a21`** (bump 1.69.0). **Push a `main` hecho → PWA desplegado por Vercel. APK 1.69.0** firmado (cert prod `3c5316d8…5065`), registrado (Y1) y subido al bucket. **`publicada=true` para 1.69.0** (1.68.0→false) → **`version_publicada()` = 1.69.0**, `minima` = 1.42.0 (nadie bloqueado).
- **3 migraciones aditivas/retrocompatibles aplicadas a prod:** `sql/2026-08-10-qa5-traspaso-idempotente.sql` (p_id idempotente), `sql/2026-08-10-qa17-proyectos-pickables.sql` (picker de obras para compras/bitácora), `sql/2026-08-10-qa13-por-confirmar-items.sql` (items[] en la bandeja del receptor). No rompen la web (callers viejos pasan NULL / ignoran la columna nueva).
- **Fixes destacados:** colisión de handlers de outbox `tarea_*` (crítico), 5 servicios fuera del bootstrap (offline atascado, S30), traspaso no idempotente, conduce invisible offline, desvío de vehículo que borraba foto+firmas, back que moría/cerraba la app en deep-links, tracking que duplicaba puntos, pickers de obra vacíos, tokens CSS invisibles.
- **Rollback:** `update sgc.app_versiones set publicada=(version='1.68.0') where plataforma='movil';` + `git revert 9395a21 9e10db0 c9b40ea && git push`. Las migraciones son aditivas (no requieren rollback; si se quisiera, revertir cada función a su definición previa).
- **PENDIENTE (Xaviel):** decisión QA-42 (término "pre-uso"); device-QA con dos teléfonos; follow-ups menores en §9 del informe (barrido de `navGuard.back` a las ~80 páginas restantes, repintar trazo de firma al rehidratar, `[ultimo]` en cierre de mantenimiento).

## SESIÓN 08/08 — PROMPT-14 ronda AJ (app) — Terminar Transporte v3 + nav + tracking + mensajería — **6 FASES, RELEASE 1.68.0 PUBLICADO (rolling)**
**Depende de PROMPT-13 (SGC `0f7a511`, 6 migraciones `sql/2026-08-08-aj*` en prod).** `npm run build` **VERDE (exit 0)**. **SHIPPED:** commit **`80cbcfa`** → push `main` → **PWA desplegado por Vercel**. **APK 1.68.0** firmado (cert prod `3c5316d8…5065`) + registrado (Y1, changelog estructurado por módulo `{t,d,m}`) + subido al bucket (`csd-app-1.68.0.apk` + `latest` + `version.json`, `apk_url` seteado). **`publicada=true` para 1.68.0** (1.67.0 → false) → **`version_publicada()` = 1.68.0**, `minima` = 1.42.0 (nadie bloqueado; todos los ≥1.42.0 reciben el aviso de actualizar). **Rollback:** `update sgc.app_versiones set publicada=(version='1.67.0') where plataforma='movil';` + `git revert 80cbcfa && git push` para el PWA. **Único pendiente = device-QA con DOS teléfonos** (chofer + receptor, uno Xiaomi) — físico, tuyo; ya está en manos de usuarios.

### FASE 1 — Navegación + pantalla de actualización (AJ2/AJ7/AJ3/AJ1) ✅
- **AJ7 (raíz encontrada y arreglada):** `push.service` deep-linkeaba con `router.navigateByUrl` directo → un push de "ruta asignada" (auto-ruta AF23 al emitir conduce) te sacaba del formulario. La guarda solo cubría el botón físico Atrás. **Fix estructural:** `NavGuardService.requestNav()` DIFIERE cualquier navegación de segundo plano mientras hay un formulario abierto y la descarga al cerrarlo. El deep-link de push ahora pasa por ese gate.
- **AJ2:** obra era el único módulo que usaba `router.navigate(['/obra'])` (PUSH) como "atrás" → ensuciaba el histórico y el botón físico ciclaba. Los **9 back de submódulos de obra** ahora usan `navGuard.back(fallback)` (POP real; nunca sale de la app en un deep-link de arranque en frío). `GuardedWizard.salir()` también usa el back seguro. Auditoría completa: ningún otro módulo tenía el antipatrón; RRHH (`/rrhh/empleados`) y mono-módulo auto-enter son por diseño (aterrizan en el home del módulo).
- **AJ1:** la pantalla de actualización pinta el changelog como **bullets agrupados por módulo** (`app_versiones.cambios[{t,d,m}]`, RLS legible) con chips por tipo, área scrolleable de altura limitada y botones SIEMPRE fijos abajo; fallback a texto plano por oraciones para versiones viejas.
- **AJ3:** "Falta charla" → banner claro y accionable **"Charla de seguridad de hoy: pendiente — Registrar →"** gateado a `obra.plan_dia` (oculto para el resto; ya no es residuo confuso).

### FASE 2 — Conduce por hojas + dropdowns + despachantes elegibles (AJ6/AJ13) ✅
- Crear conduce **rehecho como wizard de HOJAS** (step-bar + WizardFooter): Origen → Destino → Materiales → Foto de recepción → Despachante+Vehículo+Firmas → Resumen → Emitir. **Ningún listado abierto** (antes `collapsible-select` mostraba la lista completa sin selección → esa era la queja de la v1.67; ahora una hoja a la vez). Borrador AE9 intacto.
- **Se agregó el selector de VEHÍCULO** en la hoja de despacho (no existía en el HTML) → ahora AI6 (vehículo distinto) puede dispararse desde el conduce.
- Despachantes: la elegibilidad es server-side (PROMPT-13 `despachantes_disponibles` excluye oficina). La app recarga con contexto (`bodega`/`obra`) para que los vinculados salgan primero.

### FASE 3 — Estados del conduce + confirmación del receptor en SU teléfono (AJ8) ✅
- **Bug pendiente-invisible:** ya arreglado server-side (PROMPT-13, no filtra `es_prueba`); la app lista `mis_conduces_pendientes_entrega`.
- **Estados del chofer** (rehice `conduces/entrega`): Iniciar tránsito → Estoy entregando → **Marcar entregado (foto obligatoria, SIN firma del receptor)**. Por outbox (`conduce_estado_op`, `conduce_entregado`).
- **Receptor confirma en SU teléfono:** nueva página `/transporte/por-confirmar` (`mis_entregas_por_confirmar`) → foto + firma + ¿llegó todo? → `conduce_confirmar_receptor` (por outbox `conduce_confirmar`; server impide que confirme quien entregó). Banner de descubrimiento en el **Home** ("Tienes N entregas por confirmar") + tile en el hub de Conduces + deep-link de push. Ruta A,P-only (el receptor puede ser inventario/obra sin flota).
- **"Devolver" eliminado como submódulo** → el tile "Devolver a suplidor" abre el wizard de conduce pre-llenado (destino suplidor).

### FASE 4 — Mi actividad / perfil / rutas (AJ9/AJ10/AJ11/AJ12) ✅
- **AJ9:** filtro de periodo con **"1 semana"** (primero) + los 6 tiles ya presentes (Rutas/Conduces/Galones/KM/Inspecciones/Multas).
- **AJ11:** ficha **"Ver mi perfil de conductor"** (solo lectura, cuadrículas 2xN) en Mi actividad, vía `mi_perfil_conductor()`.
- **AJ10:** verificado — el desvío AI6 (vehículo no asignado → Uso de vehículo → vuelve al borrador) está en **crear-ruta Y conduce** (a este último le faltaba el selector de vehículo, ya agregado).
- **AJ12:** los campos de detalle de ruta (H.I/H.F/km/duración/trayecto) ya vienen de AI3; el replay visual de la polyline queda en FASE 5.

### FASE 5 — Seguimiento: tracking + trazado (AJ14) 🟡 app-side ✅ / nativo+Xiaomi PENDIENTE
- **HECHO (app):** cada punto GPS se **taggea con `ruta_id`** (habilita la consolidación server-side del trayecto). **Trazado en vivo:** el mapa de Seguimiento dibuja el **breadcrumb** (`ruta_breadcrumb_vivo`) de cada ruta activa (Google Maps y Leaflet), refrescado por realtime.
- **YA EXISTÍA (AF27/AG11):** foreground service (`@capacitor-community/background-geolocation` con notificación), watchdog que re-arma el watcher, batching + buffer offline, gate GPS, telemetría Y6. Los filtros de accuracy/saltos ahora son server-side (PROMPT-13).
- **PENDIENTE (nativo/dispositivo, TUYO):** (a) **exclusión de optimización de batería** con pantalla explicativa (crítico Xiaomi/MIUI) — requiere un plugin nativo, no se puede solo en TS; (b) muestreo adaptativo por tiempo (hoy `distanceFilter:40`); (c) **replay de la polyline consolidada** en el detalle de la ruta finalizada (los puntos `trayecto` ya se traen; falta el mini-mapa); (d) **validación con una ruta real en el Xiaomi**.

### FASE 6 — Launcher con tamaños + mensajería (AJ4/AJ5) ✅
- **AJ4:** modo edición del home ahora **redimensiona tiles** (1x1 / 2x1 / 2x2, botón ⤢ que cicla) además de reordenar; persiste en `get/set_module_order` (columna `size`). El permiso es **delegable**: `plataforma.layout_app` (ya no hardcodeado a admin) vía `puedeOperarSubmodulo`.
- **AJ5:** módulo **Mensajes** nuevo (mismo modelo que la web): `/mensajes` (conversaciones + nueva por búsqueda de usuario) y `/mensajes/:id` (hilo con envío **offline por outbox** idempotente por `client_id`, realtime Supabase, marcar leído). Tile general en el Home con **badge de no leídos** (`contar_mensajes_no_leidos`) y deep-link de push. **v1 = solo texto** (adjuntos: el contrato los soporta pero la UI de compose es texto; queda como follow-up).

### Archivos nuevos
`pages/transporte/por-confirmar/*`, `pages/mensajes/*` (+ `thread/*`), `core/services/mensajes.service.ts`.
### Servicios/áreas tocadas
`nav-guard.service` (gate + back seguro), `push.service` (requestNav), `guarded-wizard`, `version.service`+`actualizar` (changelog), obra (9 back + charla), `generar-conduce` (wizard), `conduces.service` (estados/confirmar/entregado + handlers), `conduces/entrega` (state machine), `conduces-hub` (Devolver→conduce, Por confirmar), `home` (banners receptor + Mensajes + tamaños), `mi-actividad`+`conductores.service` (semana + perfil), `tracking.service`+`seguimiento` (ruta_id + breadcrumb), `en-proceso.service`, `module-order.service`, `notificaciones.service` (deep-link /mensajes), `app.routes.ts`.

### PENDIENTE (Xaviel) — nada bloquea, ya está publicado
1. **Device-QA DOS teléfonos** (chofer + receptor, uno Xiaomi): conduce por hojas → pendiente entrega (badge real) → estados → entregado → **receptor confirma DESDE SU teléfono**; navegación sin saltos; tracking en vivo + breadcrumb en el Xiaomi; mensajería entre dos usuarios; tamaños de tiles; changelog legible. Si algo falla, rollback con el SQL de arriba.
2. FASE 5 nativo (batería/Xiaomi + replay polyline) y adjuntos en Mensajes = follow-up.
3. Criterio final de despachantes y `despachante_test_user_id` (parámetros SGC, sin código).

---

## Estado operativo (NOW)
- **Release actual: 1.69.0 PUBLICADA (rolling).** `version_publicada()` = 1.69.0 · `minima` = 1.42.0 (nadie bloqueado). PWA en `main` (Vercel, push hecho) + APK 1.69.0 en el bucket `app-releases`. Último commit: `9395a21`.
- **Publicar una versión a usuarios (flip rolling):** `update sgc.app_versiones set publicada=true where plataforma='movil' and version='X'; update sgc.app_versiones set publicada=false where plataforma='movil' and version='<anterior>';`. Registrar en el historial (Y1) NO publica — publicar es un paso aparte.
- **Rollback de release:** flip `publicada` a la versión anterior + `git revert <commit> && git push` para el PWA.
- **Cert de firma del APK (prod):** SHA-256 `3c5316d8…5065` (mismo desde 1.18.0; no cambiarlo o rompe las actualizaciones).
- **Piso de compatibilidad:** WebView/Chromium **≥ 111** (Angular 21). Guard nativo en MainActivity desde 1.57.0 (memoria `webview-too-old-blank-screen`).

## Comandos
- Dev/PWA `npm start` · Build `npm run build` (debe pasar antes de "done").
- APK: `npm run apk` (build firmado + registra versión Y1) → `npm run apk:publish` (sube al bucket).
- Migraciones: `node scripts/apply-migration.mjs sql/<file>.sql` (Management API vía `SUPABASE_ACCESS_TOKEN`). Cada migración: RLS + grants de schema + grants de secuencia; RPCs retrocompatibles ≥2 versiones. Secrets en `.env.local` (gitignored).

## Pendiente — solo Xaviel (verificar si ya está hecho; no bloquea el release)
1. **Seguridad AG1:** rotar/restringir en Google Cloud Console (`csd-core`) la Google/Android API key que estuvo en `google-services.json`, cerrar la alerta de GitHub y activar Push Protection. Checklist en `SECURITY-AG1-REMEDIATION.md`. La key sigue comprometida hasta rotarla. (La historia del repo ya se purgó con BFG; la anon key de Supabase es pública por diseño.)
2. **Google Maps (opcional; hoy el Seguimiento usa Leaflet):** (a) Cloud Console `csd-core` → habilitar Maps JavaScript API; (b) crear key con *HTTP referrers* `https://app.sgcconstructorasd.com/*`, `https://localhost/*`, `http://localhost:*/*` y *API restrictions* = solo Maps JS; (c) `update sgc.parametros set valor='LA_KEY' where clave='google_maps_api_key';` (no toca el repo; se sirve por RPC `maps_api_key()`). Si la key falla, cae a Leaflet.
3. **Device-QA 1.68.0 con DOS teléfonos** (chofer + receptor, uno Xiaomi) — ver la sesión de arriba.
4. **SGC web:** marcar los vehículos a ocultar a choferes (Cantus/moto) si aún no; revertir el acceso temporal al módulo `inventario` de los choferes (sus funciones viven en Transporte; el app ya lo oculta).

## Follow-ups — Claude puede hacer (no urgentes)
- FASE 5 nativo: exclusión de optimización de batería (Xiaomi/MIUI) con pantalla explicativa (necesita plugin nativo) + muestreo adaptativo por tiempo; **replay** de la polyline consolidada en el detalle de la ruta (`ruta_trayecto`; los puntos ya se traen); migrar `location-picker` a Google Maps.
- Mensajes: adjuntos (foto) en el compose (el contrato `enviar_mensaje` ya los soporta; hoy la app manda solo texto).

## Gotchas / hechos durables
Viven en la **memoria del proyecto** (`.claude/.../memory/MEMORY.md`) — no los dupliques aquí. Los más caros: WebView <111 = pantalla en blanco; permiso de ubicación DENEGADO ≠ bug de GPS; `usuarios`/`proyectos` con RLS restrictiva → usar RPC security-definer; buckets con `upsert` necesitan política UPDATE; el conductor "TEST Conductor Prueba" está ligado a la cuenta admin (no usarlo como chofer de prueba aislado); PWA iOS no puede consultar permisos de cámara (persistir flag). Contratos server-side vigentes: PROMPT-13 (AJ) en prod (SGC `0f7a511`).

## Historial de releases (una línea; el changelog completo está en `sgc.app_versiones` y en git)
- **1.69.0** (10/08) PROMPT-15 AJ15 — auditoría QA completa (`INFORME-AUDITORIA-APP.md`) + backlog resuelto: conduce offline, nav estable (deep-links), receptor registra faltante, tracking sin duplicar puntos, pickers de obra, tokens CSS invisibles, traspaso idempotente. 3 migraciones aditivas en prod. *(detalle arriba)*
- **1.68.0** (08/08) PROMPT-14 AJ — conduce por hojas, receptor confirma en su teléfono, mensajería, launcher con tamaños, nav estable, trazado en vivo.
- **1.67.0** (07/08) PROMPT-12 AI — Transporte v3: menú 3-col, conduce simplificado (foto+despachante+2 firmas), Uso de vehículo, Aviso de vehículo, Mi actividad por periodo; fix del bucle "actualizar" en PWA; obras/almacenes como dropdown.
- **1.66.0** (07/08) PROMPT-10 AH — conduces (2 firmas al emitir, transferencia entre choferes, evidencia obligatoria), paradas completables con GPS, dropdowns AH10, RRHH (empleados+asignaciones AF33), Compras de obra.
- **1.65.0** (06/08) PROMPT-8 AG16 "Mi obra" — plan del día+charla, NC/incidentes, checklists, recursos/pedidos, subcontratistas, avance, logística, informe semanal (PDF+email).
- **1.64.0** (06/08) PROMPT-6 AG — fix del secret leak (AG1), mantenimiento (historial+cierre), robustez de tracking (watchdog/telemetría), tareas dinámicas (conduce end-to-end), Google Maps + leyenda. *(Construida pero superada por 1.65.0; de aquí vienen los pendientes AG1 y Google Maps de arriba.)*
- **1.61.0–1.63.0** (04/08) PROMPT-2/4 AF — Transporte v2 a fondo.
- **1.57.0–1.60.0** (03/08) — QA de código de Transporte + guard nativo de WebView <111.
- **1.44.0–1.55.0** (31/07–03/08) — rondas AC/AD/AE: feedback de campo de Transporte, borradores AE9, ferretería, devoluciones.
- **1.32.0–1.37.0** (28–30/07) — rondas Y/AA: Proyectos+Cronograma, bitácora, dudas/guías.
- **1.18.0–1.31.0** (20–27/07) — rondas P–Z: flota, combustible, pre-uso v2, QA en equipo real (bugs de prod cerrados), historial de versiones.
- **1.0.0–1.16.0** (07–18/07) — M1 foundations (auth+PIN, outbox offline, design system, PWA) → primeras rondas (bitácora, inventario, conduces, login conductor, fix crash de foto Android).

## Verify on resume
- `git log --oneline -4` (último = `9395a21`, bump 1.69.0; antes `9e10db0`/`c9b40ea` PROMPT-15).
- `npm run build` → exit 0.
- `select sgc.version_publicada();` → publicada 1.69.0 / minima 1.42.0.
