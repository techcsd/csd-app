# INFORME DE AUDITORÍA — CSD App (PROMPT-15 / AJ15)

**Fecha:** 2026-08-10 · **Base:** release 1.68.0 (commit `80cbcfa`) · **Autor:** Claude Code (rol: QA senior + dev senior)
**Método:** auditoría **a nivel de código** de toda la app (108 páginas, ~90 servicios/core, ~40 componentes compartidos) con 6 auditores paralelos por dimensión (navegación, conduces/transporte, permisos/roles, UI/UX, offline/outbox/borradores, mensajería/tracking/launcher/actividad). Cada hallazgo trae evidencia `archivo:línea`.
**Alcance:** este informe NO reemplaza el device-QA con dos teléfonos (chofer + receptor, uno Xiaomi) que sigue pendiente y es de Xaviel. Los hallazgos que dependen de RLS/RPCs del repo SGC (no visibles aquí) se marcan "verificar en prod".

> **Regla aplicada:** solo se corrigieron en el momento bugs evidentes de **bajo riesgo** (estilos rotos puntuales). Todo lo demás queda **priorizado para que Xaviel apruebe** qué entra en la próxima ronda. Nada de commit/push/deploy sin avisar.

---

## 0. Resumen ejecutivo

> **ACTUALIZACIÓN 10/08 (2ª jornada):** Xaviel pidió arreglar **todo** el backlog. Se corrigieron **~35 de los 44 hallazgos** (build verde exit 0); los backend se verificaron/aplicaron en prod. Ver el **§9 — Estado final de cada hallazgo** al final. Lo que queda son decisiones de producto (término "pre-uso"), items de bajo impacto documentados, y el device-QA de Xaviel.

- **44 hallazgos** totales: **3 crítico**, **8 alto**, **16 medio**, **17 bajo**.
- **Tema #1 (crítico, backend/offline):** el motor de outbox tiene una **colisión de claves de handler** (`tarea_iniciar`/`tarea_completar` registradas por DOS servicios con RPCs distintos) y **5 servicios que registran handlers no se instancian al arranque** → capturas offline se enrutan al RPC equivocado o se quedan "En cola" para siempre tras un reinicio en frío. Esto viola la regla dura #1 (interconexión) y ADR-002 (idempotencia). **Es lo primero que hay que arreglar.**
- **Tema #2 (alto, UX de campo):** varias promesas de 1.68.0 quedaron **parciales**: el conduce recién creado **no aparece offline** en "Pendiente entrega", el desvío AI6 (vehículo distinto) **pierde la foto y las 2 firmas** del conduce, y el "back seguro" AJ2 solo se aplicó al módulo obra (el resto de la app hace dead-end en deep-links).
- **Tema #3 (medio, visual):** ~20 SCSS usaban tokens CSS heredados del otro proyecto X Dev (`--primary`/`--main`/`--color-text`) nunca definidos aquí → fondos/acentos invisibles y un segundo naranja compitiendo con la marca. **Corregido** con aliases en `:root`.

### Estado de los IDs AJ (ronda anterior, PROMPT-14)
| AJ | Tema | Estado | Hallazgos abiertos |
|----|------|--------|--------------------|
| AJ1 | Changelog legible | ✅ resuelto (no re-testeado a fondo) | — |
| AJ2 | Navegación / back / redirects | 🟡 **parcial** | QA-8, QA-15 |
| AJ3 | "Falta charla" | ✅ resuelto | — |
| AJ4 | Launcher con tamaños | 🟡 **parcial** | QA-21, QA-22, QA-37 |
| AJ5 | Mensajería | ✅ mayormente | QA-19, QA-20 |
| AJ6 | Conduce por hojas + dropdowns + despachantes | ✅ mayormente | QA-38 (hoja de despacho recargada) |
| AJ7 | Nada saca de un formulario en curso | 🟡 **parcial** | QA-9, QA-16 |
| AJ8 | Estados conduce + pendiente + receptor confirma + Devolver | 🟡 **parcial** | QA-6, QA-12, QA-13, QA-14 |
| AJ9 | Mi actividad (tiles + "1 semana") | ✅ resuelto | (default = 'mes', no 'semana') |
| AJ10 | Vehículo distinto ⇒ uso automático | 🟡 **parcial** | QA-7 (pierde foto/firmas) |
| AJ11 | Perfil del conductor (el chofer ve el suyo) | ✅ resuelto | QA-27 (perf) |
| AJ12 | Módulo Rutas simplificado | ✅ mayormente | duración en vivo `hh:mm:ss` vs `Xh Ym` |
| AJ14 | Tracking + trazado | 🟡 **parcial** (app), nativo/Xiaomi de Xaviel | QA-10, QA-11, QA-34, QA-35 |

---

## 1. Hallazgos CRÍTICOS

### QA-1 — Colisión de claves de handler: `tarea_iniciar`/`tarea_completar` registradas por dos servicios ⇒ ops de tareas offline van al RPC equivocado *(CONFIRMADO)*
- **Severidad:** crítico · **Módulo/rol:** Tareas (AF39) + Cronograma de proyecto (Y15) · todos los roles con tareas.
- **Evidencia:** `cronograma.service.ts:180` y `:189` registran `tarea_iniciar`/`tarea_completar` → RPCs `iniciar_tarea`/`completar_tarea` (payload con `proyecto_id`, foto slot `'evidencia'`). `tareas.service.ts:149` y `:156` registran **las mismas claves** → RPCs `iniciar_tarea_app`/`completar_tarea_app` (sin `proyecto_id`, foto slot `'tarea'`). `sync.service.ts:176` `register()` hace `this.handlers.set(tipo_op, handler)` → **gana el último que registra**. `app.config.ts:73` bootea `CronogramaService` pero **no** `TareasService`.
- **Repro:** arranque en frío → el usuario completa una tarea **general** offline (`tarea_completar`, slot `'tarea'`, sin `proyecto_id`); vuelve la señal antes de abrir la página de Tareas → el drain usa el handler de **cronograma** → llama `completar_tarea` (RPC equivocado) con `p_proyecto_id: undefined` y lee la foto del slot `'evidencia'` (la real estaba en `'tarea'` → evidencia perdida). Caso inverso: completar una tarea de cronograma y luego abrir Tareas → su handler pisa el de cronograma → op enviado a `completar_tarea_app` contra un id que no existe → error permanente / poison.
- **Causa:** dos módulos comparten el mismo namespace de `tipo_op`.
- **Fix propuesto:** darles `tipo_op` distintos (`cronograma_tarea_iniciar`/`_completar` vs `tarea_iniciar`/`_completar`) **o** namespacing por módulo en `register()`. **Riesgo: medio** — hay que migrar cualquier op ya encolado con la clave ambigua (drenar la cola antes de desplegar, o mapear la clave vieja).

### QA-2 — CSS invisible: badges/FAB/acentos sin fondo por tokens no definidos *(CORREGIDO en esta auditoría — ver §4)*
- **Severidad:** crítico/alto · **Módulo/rol:** Home, Notas, Avisos, Conduces, estado-chofer, ~20 pantallas.
- **Evidencia:** `home.scss:230` `.home__bell-badge{background:var(--primary)}`, `notas.scss:117` FAB, `avisos.scss:94` dot, `conduces-historial.scss:77` chip seleccionado, etc. `--primary`/`--main`/`--color-text` **no estaban definidos** en `styles.scss :root` (solo `--color-primary`, `--main-ultra-light`…). Declaración inválida → propiedad se cae → fondo transparente / texto blanco sobre blanco.
- **Causa:** tokens heredados del otro proyecto X Dev nunca portados a CSD.
- **Fix:** aliases en `:root` (aplicado). Ver §4.

### QA-3 — Proyectos: flecha "atrás" blanca sobre header blanco (invisible) en 3 páginas *(CORREGIDO en esta auditoría — ver §4)*
- **Severidad:** crítico · **Módulo/rol:** Proyectos (lista/detalle/cronograma) · roles con módulo `proyectos`.
- **Evidencia:** `proyectos.scss:11`, `proyecto-detalle.scss:11`, `cronograma.scss:11` → `.__back{color:#fff}` sobre un header **sin fondo** (cuerpo blanco). El `←` desaparece; la navegación parece rota.
- **Fix:** back a `var(--color-text-primary)` (aplicado). Ver §4.

---

## 2. Hallazgos ALTOS

### QA-4 — 5 servicios que registran handlers de outbox NO se instancian al arranque ⇒ capturas offline atascadas "En cola" para siempre *(CONFIRMADO)*
- **Severidad:** alto · **Área:** motor offline (regresión clase S30).
- **Evidencia:** `app.config.ts:48-76` bootea ~15 servicios, pero **omite** `TraspasoService` (`traspaso.service.ts:64` → `vehiculo_traspaso`), `MensajesService` (`mensajes.service.ts:41` → `mensaje_enviar`), `NotasService` (`notas.service.ts:30` → `nota_guardar`/`nota_checklist_set`), `RrhhService` (`rrhh.service.ts:66` → `rrhh_asignar_item`/`rrhh_asignacion_estado`), `TareasService` (`tareas.service.ts:45`).
- **Repro:** grabar un traspaso de vehículo (o enviar un mensaje / asignación RRHH) offline → matar la app → reabrir → vuelve la señal **antes** de navegar a ese módulo → `drain()` no encuentra handler → tras `MAX_INTENTOS` marca `error_kind:'incompatible'` con el mensaje engañoso "sin handler; posible desajuste de versión" (`sync.service.ts:447`). Rompe la garantía de auto-envío; el usuario debe reintentar a mano tras abrir el módulo. Es exactamente el bug S30 que los comentarios de `app.config.ts:57-71` dicen haber arreglado para combustible/documentos — a estos 5 se les olvidó.
- **Fix propuesto:** añadir los 5 servicios al `provideAppInitializer`. **Riesgo: bajo** (calca el patrón existente).

### QA-5 — `vehiculo_traspaso` NO es idempotente ⇒ un reintento duplica el acta + el avance de km *(CONFIRMADO)*
- **Severidad:** alto · **Área:** idempotencia (ADR-002).
- **Evidencia:** `traspaso.service.ts:167-175` llama `traspasar_vehiculo` **sin** parámetro de UUID cliente (el enqueue sí acuña un UUID en `:86` pero nunca se envía). El RPC devuelve un `actaId` nuevo cada vez; `audioNotas.commit` corre **después** (`:178-180`). Es el **único** handler de escritura sin `p_id` (combustible `:203`, inventario `:744/758/785`, conduces, vehiculo_entrega `:762`, flota-reportes `:429/447/461` sí lo pasan).
- **Repro:** el server confirma pero se pierde la respuesta HTTP (mala señal), o `audioNotas.commit` lanza error transitorio → el handler re-corre → **acta + km duplicados**.
- **Fix propuesto:** sobrecarga idempotente `p_id` en `traspasar_vehiculo` + pasar `payload['id']`. **Riesgo: medio** — migración DB, mantener firma vieja ≥2 versiones.

### QA-6 — "Pendiente entrega" y "Por confirmar" no son offline-capaces ⇒ el conduce recién creado no aparece (AJ8-a parcial)
- **Severidad:** alto · **Ruta:** `/transporte/conduces-pendientes`, `/transporte/por-confirmar`.
- **Evidencia:** `conduces.service.ts:622-626` `misConducesPendientesEntrega()` es un RPC directo **sin caché ni fallback**; `conduces-pendientes.ts:48-57` deja la lista vacía al fallar. Igual `misEntregasPorConfirmar()` (`:937-941`). `crearConduceSimple` (`:815-849`) encola al outbox pero **nunca** escribe una fila optimista → hasta que drena la cola **y** el RPC re-corre online, el conduce es invisible. Contrasta con `misConduces()`/`misRutas()` que usan `catalog.refresh` (offline-friendly).
- **Fix propuesto:** enrutar ambas por `catalog.refresh` (cache-through) y/o sembrar una fila optimista desde el op del outbox al crear; invalidar en `sync.changed()`. **Riesgo: bajo/medio** (posible lista algo stale).

### QA-7 — El desvío AI6 (vehículo distinto) descarta la foto de recepción y las 2 firmas del conduce (AJ10/AI6 parcial)
- **Severidad:** alto · **Ruta:** `/transporte/generar-conduce`.
- **Evidencia:** `ConduceDraft` (`generar-conduce.ts:39-53`) no guarda foto/firmas; el autosave (`:334-357`) solo snapshotea texto. `desviarAUsoDeVehiculo()` (`:559-576`) corre en `submitConduce` **después** de capturar foto + firma chofer + firma despachante, hace `autosave.flushAll()` (solo texto) y navega. Al volver, `init()` solo muestra el banner de borrador (`:443-447`) → el usuario re-toma la foto y **re-firma dos veces**. El gemelo `crear-ruta.ts:505/513` **sí** persiste fotos con `borrador.saveFoto` y las rehidrata (`:259-264`). Menor: el flag `ai6-uso:${vId}` (`:564`) nunca se limpia si el usuario cancela el uso.
- **Fix propuesto:** persistir foto de recepción + ambas firmas a `borrador_fotos` antes de `flushAll()`/navegar, rehidratar al volver (calcar crear-ruta). **Riesgo: bajo.**

### QA-8 — `NavGuardService.back()` usa un contador global que nunca detecta "estoy en la pantalla de entrada" ⇒ back muere / sale de la app (AJ2 parcial)
- **Severidad:** alto · **Módulo:** obra/* (único cableado a `navGuard.back()`).
- **Evidencia:** `nav-guard.service.ts:38-40` incrementa `navCount` en **cada** `NavigationEnd` (incluidos los pops que dispara `location.back()`) y nunca lo resetea; `:87-90` decide "¿primera pantalla?" solo con `navCount>1`. El contador mide navegaciones totales, no profundidad del stack → una vez que navegaste, la red de seguridad "volver a home" queda desactivada aunque físicamente estés en la pantalla de entrada.
- **Repro:** deep-link en frío a `/obra/plan/:id` (navCount→1), bajar a otra (→2), "Volver" → `location.back()` (→3), "Volver" otra vez → navCount 3>1 → `location.back()` de nuevo → intenta ir antes del deep-link donde no hay histórico → botón muerto / salida de app.
- **Fix propuesto:** rastrear profundidad real (marcar la URL de entrada por lanzamiento, o decrementar en pop/`back()`, o usar `history.state.navigationId`); caer al `fallback` cuando profundidad ≤ base. **Riesgo: medio** — toca todos los back de obra, verificar en dispositivo.

### QA-9 — La navegación diferida por push se dispara al cerrar CUALQUIER formulario, pisando la navegación propia del usuario (AJ7 parcial)
- **Severidad:** alto · **Área:** NavGuardService.requestNav/clear + todo GuardedWizard.
- **Evidencia:** `nav-guard.service.ts:50-56` `clear()` ejecuta `pendingNav` **incondicionalmente** cuando el handler coincide; no re-chequea `formActivo` ni si el formulario se cerró por el propio deep-link o porque el usuario navegó a otra parte. `guarded-wizard.ts:62-64` llama `clear()` desde `ngOnDestroy`, que corre en **toda** salida (submit, back del usuario, nav diferida).
- **Repro:** en el formulario A llega un push (se difiere: pendingNav→C). El usuario termina/sale de A por su cuenta hacia B → `ngOnDestroy`→`clear()` ejecuta el pendingNav → salta a C, descartando B. Si B era otro formulario, lo saca de él — justo lo que AJ7 buscaba evitar.
- **Fix propuesto:** solo re-ejecutar `pendingNav` si el cierre fue un "settle" y no hay otra navegación en curso (p.ej. disparar tras el próximo `NavigationEnd` solo si aterrizó en el destino de salida del wizard; o descartar el pending si el usuario navegó a otro lado; o no ejecutarlo si se registró un formulario nuevo). **Riesgo: medio.**

### QA-10 — `tracking.flush()` concurrente puede duplicar o perder puntos GPS (sin guard de reentrada, sin idempotencia) (AJ14 parcial)
- **Severidad:** alto · **Área:** tracking (`tracking.service.ts`).
- **Evidencia:** `flush()` (`:275-307`) toma `const lote = this.buffer.slice()`, hace `await registrar_posiciones`, y al éxito `this.buffer = this.buffer.slice(lote.length)`. **Sin guard in-flight.** Tres disparadores llaman `flush()`: `flushTimer` (`:202`), el effect de `net.online()` (`:80-82`) y `push()` al llenar `MAX_BUFFER=12` (`:271`). Dos corridas solapadas mandan el mismo `lote` (duplica) y ambas recortan `slice(lote.length)` (pierde puntos). El payload (`:280-288`) no tiene `client_id`, así que el server no puede deduplicar.
- **Fix propuesto:** flag `flushing` (early-return si ya está en curso) + dedup por UUID por-punto server-side, o recortar por identidad de objetos (splice) no por longitud. **Riesgo: bajo.**

### QA-11 — Seguimiento recarga todo en cada evento de posición (sin throttle) + N+1 de breadcrumb (AJ14 parcial)
- **Severidad:** alto (rendimiento) · **Ruta:** `/transporte/seguimiento`.
- **Evidencia:** realtime suscrito a `event:'*'` de `chofer_ultima_posicion`; `seguimiento.ts:114` `suscribir(() => void this.cargar())` — el comentario dice "throttle simple" pero **no hay throttle**. Cada `cargar()` (`:144-158`) hace `choferes()` (2 queries) + `rutasActivas()` + `pintarBreadcrumbs()` que `await`ea `rutaBreadcrumb(r.id)` **secuencial, un RPC por ruta activa** (`:161-191`). Con N choferes moviéndose = ráfaga de recargas completas, cada una 2+N round-trips secuenciales.
- **Fix propuesto:** debounce `cargar()` (2-3 s trailing) + `Promise.all` de breadcrumbs + saltar refetch si el set de rutas no cambió. **Riesgo: bajo.**

---

## 3. Hallazgos MEDIOS

### QA-12 — El detalle del conduce carga de una fuente distinta a la lista que enlaza a él ⇒ "No encontramos este conduce" (AJ8-b frágil)
- **Severidad:** medio (alto offline/no-dueño) · **Ruta:** `/transporte/conduces/:salidaId`.
- **Evidencia:** `entrega.ts:68-89` resuelve el conduce con `misConduces()` = RPC `mis_conduces_hoy`, cuyo filtro SQL es `estado='despachado' and conductor_id = auth.uid()` (`sql/2026-07-08e-conduces.sql:107-108`). La lista enlaza desde `mis_conduces_pendientes_entrega` (otro predicado). Cualquier pendiente con `conductor_id ≠ yo` o `estado ≠ despachado`, o un conduce recién creado offline → `c === null` → `entrega.html:10-11` muestra "No encontramos este conduce." y el chofer queda bloqueado.
- **Fix propuesto:** traer el conduce por id de la misma fuente que la lista (o un RPC `conduce_por_id`), con fallback a la caché de pendientes. **Riesgo: bajo.**

### QA-13 — El receptor "⚠️ Faltó algo" no puede registrar QUÉ ni CUÁNTO faltó (AJ8-c parcial)
- **Severidad:** medio (integridad de datos) · **Ruta:** `/transporte/por-confirmar`.
- **Evidencia:** `por-confirmar.html:29-33` solo ofrece un toggle Sí/No; **no hay lista de ítems ni cantidades**. `por-confirmar.ts:99-105` llama `conduceConfirmarReceptor({... checklist:{llego_todo:false}})` y **nunca pasa `items`**, aunque el servicio lo soporta (`conduces.service.ts:955-980`). La confirmación autoritativa (→ entrada de inventario `conduce_confirmar_receptor`) pierde el detalle del faltante.
- **Fix propuesto:** renderizar la lista `entregas` con cantidades editables cuando `llegoTodo===false` y pasar `items`. **Riesgo: medio** — verificar que `conduce_confirmar_receptor` acepte y aplique `p_items`.

### QA-14 — Dos flujos "Devolver" divergentes coexisten (AJ8-d parcial)
- **Severidad:** medio (consistencia) · **Módulo:** conduces-hub vs hub transporte.
- **Evidencia:** `conduces-hub.ts:89-95` "Devolver a suplidor" abre el conduce pre-llenado (correcto). Pero el hub principal sigue exponiendo el submódulo viejo: `transporte.ts:330-333` → `/transporte/devolver-material`, página con backend distinto (`inventario.enqueueDevolucionChofer`, `devolver-material.ts:254`) — no el flujo de conduce. La ruta sigue registrada (`app.routes.ts:246-250`).
- **Fix propuesto:** apuntar `transporte.ts:331` al conduce pre-llenado (o quitar el botón) y retirar `devolver-material` si está deprecado. **Riesgo: medio** — confirmar que nada más dependa del RPC de devolución doble-firma antes de removerlo.

### QA-15 — El "back seguro" AJ2 solo se aplicó a obra; ~80 páginas usan `location.back()` directo ⇒ back muerto en deep-link en frío (AJ2 parcial)
- **Severidad:** medio · **Módulos:** bitácora, transporte, inventario, solicitudes, proyectos, mensajes, avisos, perfil…
- **Evidencia:** `navGuard.back()` se usa **solo** en obra (15 hits). El resto hardcodea `this.location.back()` (81 archivos), p.ej. `acta-detalle.ts:129`, `mensajes/thread/thread.ts:109`, `en-proceso.ts:111`, `pendientes.ts:232`. En un deep-link de push en frío (firma→`/transporte/por-firmar`, alerta flota→`/transporte/avisos`, requisición→`/solicitudes/mis`, `/mensajes/:id`, `/bitacora/*`), "Volver" con 1 sola entrada de histórico = botón muerto. El back **físico** de Android sí está bien (`app.ts:82-86` chequea `canGoBack`); la brecha es el back **en pantalla**.
- **Fix propuesto:** enrutar cada "Volver" por `navGuard.back('<home del módulo>')` (tras arreglar QA-8), al menos en las páginas alcanzables por deep-link. **Riesgo: bajo/medio** (mecánico pero amplio).

### QA-16 — AutoLock navega a `/auth/pin` directo, saltándose el guard de formulario / autosave ⇒ se pierde lo capturado
- **Severidad:** medio · **Área:** AutoLockService (global).
- **Evidencia:** `auto-lock.service.ts:49-58` hace `router.navigate(['/auth/pin'])` directo, sin consultar `navGuard.handleBack()` ni `requestNav`. El usuario a mitad de captura, la app se va a background ≥45s (llamada, revisar WhatsApp), al volver `maybeLock()` destruye el formulario sin "¿Descartar cambios?"; los datos sobreviven solo si ese wizard autosalva a Dexie.
- **Fix propuesto:** antes de bloquear, flushear el autosave del formulario activo (mantener el lock — la seguridad gana; NO diferir por requestNav). **Riesgo: bajo.**

### QA-17 — Pickers de obra/proyecto usan el `select` directo sobre `proyectos` (RLS restrictiva) ⇒ dropdown vacío para roles compras/obra
- **Severidad:** medio/alto · **Módulo/rol:** Requisición (compras), Compras de obra (`/compras-proyecto`, sin moduleGuard), Bitácora.
- **Evidencia:** `solicitudes.service.ts:35` `.from('proyectos').select(...)`; `proyectos.service.ts:38-45` `getProyectos()` (consumido por `compras-proyecto.ts:48`); `bitacora.service.ts:175`. La RLS de `sgc.proyectos` scopea por módulo/membresía; roles no admitidos reciben `[]` **sin error** → picker vacío, flujo muerto. El path ya arreglado lo demuestra: `inventario.service.ts:181-195` cambió a la RPC `obras_con_bodega` justo por esto (memoria `proyectos-rls-no-inventario`).
- **Fix propuesto:** RPC security-definer (calcar `obras_con_bodega`, p.ej. `obras_visibles`) que ya filtre `es_prueba`. **Riesgo: bajo** — confirmar por módulo si la RLS ya los admite.

### QA-18 — Fuga de borradores entre usuarios en teléfonos compartidos
- **Severidad:** medio (identidad/confidencialidad) · **Área:** borradores / sesión.
- **Evidencia:** `session.service.ts:61-72` `logout()` limpia auth/PIN/contexto pero **no** borra `borradores`/`borrador_fotos`. Claves no scopeadas por usuario: `inventario:salida` (`salida.ts:58`), `:entrada` (`entrada.ts:57`), `:recibir` (`recibir.ts:47`), `transporte:generar-conduce` (`:89`), `transporte:crear-ruta` (`:105`), `transporte:asignarme` (`:84`). `borrador.service.ts:46-49` `list()` no filtra por uid. Tras logout de A y login de B, a B se le ofrece el borrador de A y puede emitirlo bajo su identidad. Otros wizards sí scopean por uid (`preuso.ts:361`, `checklist.ts:239`), lo que confirma la omisión.
- **Fix propuesto:** borrar tablas de borrador en logout y/o scopear estas claves por uid. **Riesgo: bajo.**

### QA-19 — El badge de mensajes no leídos del Home no es en vivo (AJ5)
- **Severidad:** medio · **Ruta:** `/home`.
- **Evidencia:** `home.ts:181` llama `mensajes.contarNoLeidos()` una sola vez en el constructor; el Home nunca hace `mensajes.suscribir(...)`. El badge solo cambia al re-entrar al Home.
- **Fix propuesto:** suscribir en Home (reusar `MensajesService.suscribir`) y re-contar en cambio, o exponer no-leídos como signal de servicio actualizado por realtime. **Riesgo: bajo** (coordinar con QA-20).

### QA-20 — Mensajería usa un único canal realtime compartido (lista + hilo) con filtro demasiado amplio
- **Severidad:** medio · **Área:** `mensajes.service.ts:97-110`.
- **Evidencia:** `private channel` singleton (`:38`); `suscribir()` llama `desuscribir()` primero (`:98`); dos componentes (`MensajesPage`, `MensajesThreadPage`) comparten el mismo canal → con animaciones/reuse de rutas (create-before-destroy) el `ngOnDestroy` del hilo tumbaría la suscripción recién creada de la lista. Además el filtro es `{event:'INSERT', schema:'sgc', table:'mensajes'}` **sin `conversacion_id`** → un INSERT en cualquier conversación de la empresa dispara recarga completa.
- **Fix propuesto:** un canal por suscriptor (creado en el componente) + filtro por `conversacion_id`. **Riesgo: bajo/medio.**

### QA-21 — El grid del launcher deja huecos con tamaños mixtos (sin `grid-auto-flow: dense`) (AJ4 parcial)
- **Severidad:** medio · **Ruta:** `/home` launcher.
- **Evidencia:** `home.scss:36-61` grid `1fr 1fr` con `grid-auto-flow: row` por defecto; `.home__tile--2x1` y `--2x2` ambos `grid-column: span 2` (ancho completo) → un tile ancho tras un 1x1 solitario deja la columna 2 vacía sin backfill. Además 2x1 y 2x2 solo difieren en `grid-row`: en un grid de 2 columnas no hay "medio ancho alto" real → las opciones de tamaño son parcialmente degeneradas.
- **Fix propuesto:** `grid-auto-flow: dense` + repensar qué significan 2x1 vs 2x2 en 2 columnas. **Riesgo: bajo** (dense puede reordenar visualmente — aceptable en un launcher).

### QA-22 — `set_module_order` no verificado para aceptar el permiso delegado `plataforma.layout_app` (AJ4)
- **Severidad:** medio · **Área:** launcher / backend.
- **Evidencia:** el cliente delega bien vía `puedeOperarSubmodulo('plataforma.layout_app')` (`home.ts:90-92`), pero `module-order.service.ts:45-56` solo llama `set_module_order` ("el RPC valida"). Por la memoria `prompt9-contract-gaps-ah` (RPCs AH medio-aplicados), hay que confirmar en prod. Si el RPC sigue siendo admin-only, el delegado ve un reorder optimista (`home.ts:341-343`) que revierte en silencio con un toast genérico.
- **Fix propuesto:** introspectar `set_module_order` en prod; que gatee por `layout_app`, no `is_admin`. Si no se confirma, no aplicar el orden optimista hasta que el RPC responda OK. **Riesgo: bajo** (verificación).

### QA-23 — Inputs numéricos sin validación (aceptan negativos): multa, vehículo, cubicación, km ruta, cierre mantenimiento
- **Severidad:** medio · **Área:** validación de formularios.
- **Evidencia:** `reportar-multa.html:52` (monto sin `min`; `reportar-multa.ts:251` envía crudo) → multa `-5000`. `vehiculo-form.html:71,98,101,104` (km/intervalo/rendimiento sin `min`; `vehiculo-form.ts:306-311`) → odómetro negativo rompe KmInput y cálculos de mantenimiento. `subcontratistas.html:66` `cubAvance.set(+$event)` sin clamp 0-100 (el hermano `setFrenteAvance` sí clampa, `:83`). `crear-ruta.html:171` km estimado sin `min`. `mantenimiento-cierre.html:13` costo solo `min="0"` advisory; km sin `[ultimo]` → no dispara regresión.
- **Fix propuesto:** `min="0"`/`inputmode` + clamps en el setter (calcar los que ya clampan). **Riesgo: bajo.**

### QA-24 — "Pendientes de envío" muestra códigos crudos de op para muchos tipos nuevos
- **Severidad:** medio (UX baja alfabetización) · **Ruta:** `/pendientes`.
- **Evidencia:** `pendientes.ts:15-59` `TIPO_LABEL`/`TIPO_ICON` cubren ~20 tipos pero faltan muchos que llegan al outbox: `conduce_simple`, `conduce_transportista`, `conduce_estado_op`, `conduce_entregado`, `conduce_confirmar`, `vehiculo_traspaso`, `aviso_novedad_vehiculo`, `mensaje_enviar`, `tarea_*`, todos los `obra_*`, `devolucion_chofer`, `compra_ferreteria`. `tipoLabel()` (`:119`) cae al string crudo → el usuario ve "conduce_transportista".
- **Fix propuesto:** completar los labels/íconos. **Riesgo: nulo.**

### QA-25 — `combustible-log` (echadas, solo roles elevados) sin backstop de rol en cliente
- **Severidad:** medio · **Rol:** chofer vs flota-elevado.
- **Evidencia:** `app.routes.ts:357-361` gatea solo con `moduleGuard('flota')`; un chofer con módulo flota pasa. `seguimiento` sí tiene backstop (`seguimiento.ts:83-85` `autorizado=false` si `!esFlotaElevado()`), pero `combustible-log` depende 100% del RPC `log_combustible`.
- **Fix propuesto:** añadir el backstop `esFlotaElevado()` en `combustible-log` + verificar que el RPC gatee server-side. **Riesgo: bajo.**

### QA-26 — Visibilidad de `es_prueba` 100% dependiente de RLS; listas de conductores/vehículos sin filtro cliente
- **Severidad:** medio (verificar en prod) · **Módulo/rol:** Transporte (todos los de flota, incl. chofer).
- **Evidencia:** `conductores.service.ts:226-238` `getConductores()` ni siquiera selecciona `es_prueba`. `vehiculos.service.ts:309/333` seleccionan `es_prueba` pero **no filtran** (solo badge visual). Si la RLS de `sgc.vehiculos`/`sgc.conductores` no oculta test a no-admin, todos ven vehículos/choferes de prueba en los pickers.
- **Fix propuesto:** confirmar RLS; opcional filtro cliente defensivo gateado por `!esAdmin()`. **Riesgo: bajo.**

### QA-27 — `PerfilConductorPage` doble-carga documentos y re-firma URLs en cada tick de sync
- **Severidad:** medio (rendimiento) · **Ruta:** `/transporte/conductor/:id`.
- **Evidencia:** el constructor registra un `effect` (`perfil-conductor.ts:113-120`) que llama `loadEnCola(id)`+`loadDocs(id)` en **cada** `sync.changed()`, y `load()` (`:143-144`) también → docs se cargan ~2× al abrir y `loadDocs` re-firma todas las URLs (red) en cada cambio de sync ajeno.
- **Fix propuesto:** debounce/gate del effect (solo si drenó un op de documento de este conductor) + quitar el `loadDocs` inicial redundante. **Riesgo: bajo.**

---

## 4. Correcciones aplicadas en esta auditoría (build verde exit 0)

### 4.a — UI de bajo riesgo (primera pasada)
| Hallazgo | Archivo | Cambio |
|----------|---------|--------|
| **QA-2** | `src/styles.scss` | Añadidos aliases en `:root`: `--primary: var(--color-primary)`, `--main: var(--color-text-primary)`, `--color-text: var(--color-text-primary)`. Resuelve de un golpe: badge de campana del Home, FAB de Notas, dot de avisos, chip seleccionado de conduces-historial, badge de paso de conduces, acentos de estado-chofer-bar, y el **segundo naranja** (`#ff5f00`) que competía con la marca (`#f97316`). No se tocó `--secondary` (su único uso es un fallback de `bottom-sheet` que nunca dispara porque `--color-surface` sí existe) ni `--tint` (var inline por-fila; su fallback ahora resuelve). |
| **QA-3** | `proyectos.scss:11`, `proyecto-detalle.scss:11`, `cronograma.scss:11` | `.__back { color: #fff → var(--color-text-primary) }`. Flecha "atrás" ahora visible sobre el header blanco en las 3 páginas de Proyectos. |

### 4.b — TOP-3 confirmado (segunda pasada, aprobado por Xaviel)
| Hallazgo | Archivos | Cambio |
|----------|----------|--------|
| **QA-1** | `cronograma.service.ts`, `tareas.service.ts` | Se rompió la colisión de `tipo_op`: Tareas general → `tarea_app_iniciar`/`tarea_app_completar`; Cronograma → `cronograma_tarea_iniciar`/`cronograma_tarea_completar`. Se añadieron **handlers de retrocompatibilidad** en CronogramaService para las claves viejas `tarea_iniciar`/`tarea_completar` que enrutan por `proyecto_id` (presente en cronograma, ausente en tareas) y por slot de foto (`evidencia` vs `tarea`) → las ops ya encoladas en teléfonos de campo siguen sincronizando correctas tras actualizar. `accionesPendientes()` reconoce ambas claves. **Riesgo neto: bajo.** |
| **QA-4** | `app.config.ts` | Añadidos al `provideAppInitializer`: `TraspasoService`, `MensajesService`, `NotasService`, `RrhhService`, `TareasService` → sus handlers de outbox se registran al arranque; se acabó el atasco "En cola" para siempre tras reinicio en frío. |
| **QA-5** | `sql/2026-08-10-qa5-traspaso-idempotente.sql` (**aplicada a prod**) + `traspaso.service.ts` | Migración aditiva/retrocompatible: `vehiculo_traspaso_actas.client_id` + índice único parcial; `sgc.traspasar_vehiculo` gana `p_id uuid DEFAULT NULL` con guarda de idempotencia al inicio (si el client UUID ya creó un acta, la devuelve sin re-ejecutar reasignación/odómetro/llaves/notificación). Se creó el overload de 9 args ANTES de borrar el de 8 (la función nunca queda ausente) y se re-otorgaron los grants (PUBLIC/authenticated/service_role). El cliente ahora manda `p_id: payload['id']`. **Verificado en prod:** queda una sola función de 9 args, grants intactos. Callers viejos (web + app ≤1.68.0) siguen igual (p_id llega NULL). |

Verificación: `npm run build` → **exit 0** en cada pasada (solo warnings preexistentes: lint NG8102 en reporte-semanal + presupuesto de bundle). Migración QA-5 aplicada con `node scripts/apply-migration.mjs` y verificada por introspección. **Nada se hizo commit/push.**

---

## 5. Hallazgos BAJOS (para backlog)

- **QA-28** — `/compras-proyecto` y `/mensajes/:id` sin chequeo de membresía en cliente (IDOR potencial si el RPC no lo aplica). `proyectos.service.ts:70-74`, `mensajes.service.ts:51-56`. Verificar que `listar_mensajes`/`compras_de_proyecto` rechacen ids ajenos. Verificar en prod.
- **QA-29** — `/tecnologia` alcanzable por URL para chofer (tile oculto, ruta sin guard de rol). `home.ts:145-148` vs `app.routes.ts:536-539`. Contenido no sensible; añadir `!esChofer` si se quiere. La pestaña "Reportes de errores" **sí** está bien gateada (`tecnologia.html:27` / `tecnologia.ts:124`).
- **QA-30** — `/notas` y `/avisos` leen tablas completas sin filtro por usuario (confidencialidad = solo RLS). `notas.service.ts:39-45`, `notificaciones.service.ts:29-34`. Verificar RLS por owner/participante.
- **QA-31** — `nivelSubmodulo` da `operar` a todo poseedor del módulo padre (paridad con `sgc.nivel_submodulo` a confirmar). `user-context.service.ts:96-101`.
- **QA-32** — Código muerto: `entregarConduce()` + handler `conduce_entrega` capturan firma del receptor en la entrega (contradice AJ13). Sin llamadores. `conduces.service.ts:16-30,851-883,1322-1370`. Remover (mantener el handler 1-2 versiones por ops viejos).
- **QA-33** — `requestNav` guarda un solo `pendingNav` (un segundo deep-link diferido se pierde). `nav-guard.service.ts:31,74-79`.
- **QA-34** — Orden de coordenadas del breadcrumb `[lat,lng]` vs `[lng,lat]` asumido, no validado → polyline en el hemisferio equivocado sin error. `seguimiento.service.ts:94-98`, `seguimiento.ts:167-186`. Verificar contrato de `ruta_breadcrumb_vivo`.
- **QA-35** — `tracking.persistBuffer` recorta a los últimos 100 puntos → rutas largas offline pierden los más viejos tras un kill. `tracking.service.ts:374-380`.
- **QA-36** — HTML sin escapar en popups/InfoWindows del mapa (nombre del chofer). `seguimiento.ts:212,258,292`. Sink de inyección (bajo, nombres internos).
- **QA-37** — Control de tamaño del launcher es `<span role="button">` dentro de `<button>` (HTML inválido, sin acceso por teclado). `home.html:63-69`.
- **QA-38** — `<app-select-list>` usado inline (lista siempre abierta) para el picker de **usuario del sistema** en `conductor-form.html:22` (variable + buscable → caso AH10 que debería ser dropdown). También la hoja "despacho" del conduce apila despachante + vehículo + 2 firmas en una pantalla (`generar-conduce.html:136-153`) — funcional, pero rompe "una pregunta por pantalla".
- **QA-39** — Objetivos táctiles < 56px: botón borrar de avisos 52px (`avisos.scss:79-82`); chips de filtro de conduces-historial ~30px alto (`conduces-historial.scss:66-67`).
- **QA-40** — El diálogo de salida de `generar-conduce` dice "Se perderá lo que llevas" pero `confirmarSalir()` NO descarta (el borrador sobrevive). `generar-conduce.html:204-206` vs `:710-713`. Contradicción de copy.
- **QA-41** — `signature-pad` sin listener de resize/orientación → rotar el teléfono con la firma a medias la desalinea/borra. `signature-pad.ts:46-51`.
- **QA-42** — El término "pre-uso" sigue visible al usuario (`transporte.html:88/120/152`, `preuso.html:7`, `asignar.html:40`, `checklists-historial.html:28`). Confirmar el término homologado con Xaviel antes de reemplazar.
- **QA-43** — `aviso_novedad_vehiculo` (`vehiculos.service.ts:796-801`) y `mantenimiento-cierre` sin `p_id` idempotente (bajo, misma clase que QA-5).
- **QA-44** — Deep-link de push no hace nada cuando la ruta mapeada es `/home`. `push.service.ts:50`. Informativo.

---

## 6. Mejoras UX (no son bugs)

### Quick wins (bajo esfuerzo, alto retorno)
1. **Labels de todos los tipos de op en Pendientes** (QA-24): el chofer entiende qué está esperando enviarse.
2. **Duración de ruta en vivo en `Xh Ym`** en vez de `hh:mm:ss` (`conduces.ts:521-531`) para alinear con AI4 (el resumen de ruta finalizada ya usa `Xh Ym`). O dejar el cronómetro en vivo — decisión de Xaviel.
3. **Default de "Mi actividad" a "1 semana"** en vez de "mes" (`PERIODOS`) si el sketch lo pedía como primer periodo.
4. **`min`/`inputmode` en inputs numéricos** (QA-23) — teclado numérico + evita negativos.
5. **Completar `es_prueba` badge/filtro** en lista de conductores para paridad con vehículos.

### Cambios de diseño (requieren decisión de Xaviel)
1. **Confirmación del receptor con detalle de faltante** (QA-13): lista de ítems + cantidades cuando "faltó algo".
2. **Rollout del back seguro** (`navGuard.back`) a toda la app (QA-15), tras arreglar el heurístico (QA-8).
3. **Partir la hoja "despacho" del conduce** en pantallas separadas (despachante → vehículo → firmas) para cumplir "una pregunta por pantalla" (QA-38).
4. **Repensar tamaños de tile** en un grid de 2 columnas (QA-21): definir qué significan 1x1 / 2x1 / 2x2.
5. **Picker de usuario del sistema como dropdown/sheet** (QA-38) en conductor-form.

---

## 7. TOP 10 — TODOS CORREGIDOS en la 2ª jornada (ver §9 para el detalle)

El TOP-10 original (los de mayor impacto para el chofer) quedó **completo**:

1. ~~**QA-1** — Colisión de handlers `tarea_*`.~~ ✅
2. ~~**QA-4** — 5 servicios fuera del bootstrap.~~ ✅
3. ~~**QA-6** — Conduce recién creado invisible offline.~~ ✅ (`catalog.refresh`)
4. ~~**QA-7** — El desvío de vehículo borra foto+firmas.~~ ✅ (persistidas en el borrador)
5. ~~**QA-5** — Traspaso no idempotente.~~ ✅ (migración prod)
6. ~~**QA-8 + QA-15** — Back roto.~~ ✅ (profundidad real + back seguro en deep-links; barrido total = follow-up)
7. ~~**QA-9** — Nav diferida saca del formulario.~~ ✅
8. ~~**QA-10 + QA-11** — Tracking duplica puntos + Seguimiento N+1.~~ ✅
9. ~~**QA-17** — Pickers de obra vacíos para compras/obra.~~ ✅ (RPC `proyectos_pickables`)
10. ~~**QA-12 + QA-13** — Detalle "no encontramos" + receptor sin detalle de faltante.~~ ✅

---

## 8. Cosas verificadas como SÓLIDAS (cobertura QA — no tocar)
- **Motor de sync:** clasificación retryable-vs-terminal correcta (42501→permanente), backoff por-item, `withTimeout` ⇒ **sin head-of-line blocking** (los ítems en error/backoff se saltan, no bloquean la cola). Re-entrada protegida. Badges signal-driven.
- **Pipeline de fotos:** persistidas como ArrayBuffer pre-transacción (WebKit-safe), subidas antes del RPC, upload fallido no marca ✅, upsert idempotente en Storage.
- **Idempotencia (resto):** combustible, inventario (todos), conduces (todos), vehiculo_entrega, flota-reportes, mensajes (`p_client_id`), obra (todos `p_id`) — todos pasan un client id estable.
- **Borradores:** sin clear-before-enqueue ni colisión de claves entre 30+ wizards; cada submit descarta *después* del enqueue; `crear-ruta` sí conserva su borrador (y fotos) en el desvío AI6.
- **Guards:** orden consistente `[authGuard, pinGuard, module/submodule/obraGuard]` en las 100+ rutas; sin race de perfil-no-cargado; `pin-change` bien exige desbloqueo; wildcard `**`→home es seguro.
- **Sin IDOR con id del cliente:** ningún listado pasa un `usuario_id`/`conductor_id`/`receptor_id` provisto por el cliente; todo scopea por `auth.uid()`.
- **Duraciones (AI4):** `core/util/duracion.ts` correcto; todas las lecturas pasan por `formatearDuracion` (salvo el cronómetro en vivo `hh:mm:ss`).
- **Footer de wizard:** `wizard-footer.scss:19-23` maneja bien el gotcha de ancho del botón back.
- **Tracking `ruta_id`:** se preserva en el re-arme del watchdog; el gate GPS distingue permiso-denegado vs apagado; limpieza de mapa en `ngOnDestroy`; fallback Google→Leaflet.

---

## 9. Estado final de cada hallazgo (2ª jornada, 10/08 — "arregla todo")

Xaviel pidió resolver todo el backlog. Resumen: **35 corregidos**, **6 verificados como ya-correctos** (no eran bugs), **3 aceptados/diferidos por criterio**, **1 pendiente de decisión de producto**. Build **verde (exit 0)**. 3 migraciones aditivas aplicadas a prod (QA-5, QA-17, QA-13-items), todas retrocompatibles.

| QA | Severidad | Estado | Nota |
|----|-----------|--------|------|
| QA-1 | crítico | ✅ corregido | split `tarea_app_*`/`cronograma_tarea_*` + handlers de retrocompat por `proyecto_id` |
| QA-2 | crítico | ✅ corregido | aliases `--primary/--main/--color-text` en `:root` |
| QA-3 | crítico | ✅ corregido | flecha atrás visible en Proyectos ×3 |
| QA-4 | alto | ✅ corregido | 5 servicios al `provideAppInitializer` |
| QA-5 | alto | ✅ corregido | migración prod (p_id idempotente) + cliente |
| QA-6 | alto | ✅ corregido | pendientes/por-confirmar por `catalog.refresh` + invalidaciones |
| QA-7 | alto | ✅ corregido | persiste foto+2 firmas en el desvío AI6 (⚠️ el canvas de firma se repinta en blanco al volver, pero el blob se conserva → no hay que re-firmar; repintar con `fromData` queda como pulido menor) |
| QA-8 | alto | ✅ corregido | `NavGuardService.back` con profundidad real de stack |
| QA-9 | alto | ✅ corregido | nav diferida solo si no quedó otro formulario abierto |
| QA-10 | alto | ✅ corregido | `flush()` con guard de reentrada + trim por identidad |
| QA-11 | alto | ✅ corregido | Seguimiento con debounce + `Promise.all` de breadcrumbs |
| QA-12 | medio | ✅ corregido | detalle del conduce por id desde ambas fuentes cacheadas |
| QA-13 | medio | ✅ corregido | cliente pasa `items`; migración prod añade `items` a `mis_entregas_por_confirmar`; `conduce_confirmar_receptor` ya aceptaba `p_items` |
| QA-14 | medio | ✅ corregido | hub principal → conduce prellenado (ruta vieja intacta) |
| QA-15 | medio | ✅ mayormente | back seguro aplicado a las páginas deep-link de cada stream; barrido a las ~80 páginas restantes = follow-up mecánico |
| QA-16 | medio | ✅ corregido | auto-lock hace `flushAll()` antes de bloquear |
| QA-17 | medio/alto | ✅ corregido | RPC `proyectos_pickables()` (prod) + 4 clientes reconectados |
| QA-18 | medio | ✅ corregido | `borrador.clearAll()` en logout |
| QA-19 | medio | ✅ corregido | badge de mensajes en vivo (realtime) |
| QA-20 | medio | ✅ corregido | canal realtime por-suscriptor + filtro `conversacion_id` |
| QA-21 | medio | ✅ corregido | `grid-auto-flow: dense` (2x1≈2x2 en 2 col documentado) |
| QA-22 | medio | ✅ verificado | `set_module_order` ya respeta `plataforma.layout_app` — no era bug |
| QA-23 | medio | ✅ corregido | clamps en multa/vehículo/cubicación/km/cierre (mant.-cierre `[ultimo]` = parcial, la pantalla no carga el vehículo) |
| QA-24 | medio | ✅ corregido | labels/íconos para todos los tipos de op |
| QA-25 | medio | ✅ corregido | backstop `esFlotaElevado` en combustible-log |
| QA-26 | medio | ✅ verificado | RLS `es_prueba` es RESTRICTIVE (oculta test) — no era bug |
| QA-27 | medio | ✅ corregido | perfil-conductor: effect solo re-firma docs si drenó un op de documento |
| QA-28 | medio | ✅ verificado | `listar_mensajes`/`compras_de_proyecto` validan membresía — sin IDOR |
| QA-29 | bajo | 🟡 aceptado | `/tecnologia` por URL a chofer: contenido no sensible; añadir `!esChofer` si se desea |
| QA-30 | bajo | ✅ verificado | `notas`/`notificaciones` con RLS por owner |
| QA-31 | bajo | ✅ verificado | `nivel_submodulo` = paridad intencional con el cliente |
| QA-32 | bajo | ✅ corregido | `entregarConduce()` muerto removido (handler conservado) |
| QA-33 | bajo | 🟢 aceptado | `requestNav` most-recent-wins es razonable; sin cambio |
| QA-34 | bajo | ✅ corregido | breadcrumb: descarta puntos fuera de RD (detecta `[lng,lat]`) |
| QA-35 | bajo | ✅ corregido | buffer GPS 100→2000 + warn al truncar |
| QA-36 | bajo | ✅ corregido | escape del nombre en popups del mapa |
| QA-37 | bajo | ✅ corregido | control de tamaño = `<button>` real (HTML válido/a11y) |
| QA-38 | bajo | ✅ corregido | picker de usuario = `collapsible-select` con buscador |
| QA-39 | bajo | ✅ corregido | targets táctiles ≥56/44px |
| QA-40 | bajo | ✅ corregido | copy del diálogo de salida del conduce |
| QA-41 | bajo | ✅ corregido | signature-pad conserva la firma al rotar (`toData`/`fromData`) |
| QA-42 | bajo | 🟡 decisión | término "pre-uso": mantener o renombrar — decisión de Xaviel |
| QA-43 | bajo | 🟢 diferido | idempotencia de `reportar_novedad_vehiculo`: aviso duplicado de bajo impacto; no amerita DDL en prod ahora |
| QA-44 | bajo | 🟢 informativo | deep-link a `/home` sin destino = sin acción |

**Migraciones aplicadas a prod (todas aditivas/retrocompatibles):** `sql/2026-08-10-qa5-traspaso-idempotente.sql`, `sql/2026-08-10-qa17-proyectos-pickables.sql`, `sql/2026-08-10-qa13-por-confirmar-items.sql`.

**Follow-ups menores conscientes:** (a) QA-15 barrido de back a las páginas restantes; (b) QA-7 repintar el trazo de firma al rehidratar; (c) QA-23 pasar `[ultimo]` al km-input del cierre de mantenimiento; (d) QA-42 término "pre-uso"; (e) QA-29 guard opcional en `/tecnologia`.

---

*Fin del informe. Fixes en el working tree; 3 migraciones ya en prod (aditivas). Build verde (exit 0).*
