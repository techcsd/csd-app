# PARIDAD — CSD App (móvil) ↔ SGC (web)

> Regla 5 (interconexión/consistencia): la app y la web comparten **los mismos
> nombres y valores de token semántico**. Este archivo registra la paridad del
> rediseño **CB (v2, 28/09/2026)** y las divergencias **deliberadas** (no son
> bugs; no "corregir" para igualar a la web).

## Fuente de verdad
- Web: `SGC/src/styles/_tokens.scss` (semántico = fuente, `--sgc-*` = alias).
- App: `csd-app/src/styles/_tokens.scss` (**shim inverso, BH5**): `--color-*` = fuente
  de valores (194 componentes la consumen), los nombres semánticos de la web
  (`--bg`, `--surface`, `--brand`, `--accent`, `--text`, `--success/-bg`…) son
  **alias** que apuntan a `--color-*`. Resultado: **mismos valores semánticos** que la web.

## Tokens con VALOR IDÉNTICO a la web (CB v2, claro / oscuro)
Superficies (`--bg #f5f6f8`/`#0b121c`, `--surface #ffffff`/`#111a26`, `--surface-2`,
`--surface-3`, `--border #e4e7ec`/`#1e2b3c`, `--border-strong`), texto (`--text
#101828`, `--text-2 #5b6b80`, `--text-3 #7a8799`), marca+acento (`--brand #1e3a5f`,
`--brand-hover #17304f`, `--brand-soft #eef3f9`, `--accent #f97316`, `--accent-hover
#ea580c`, `--accent-soft #fff4ec`, **`--text-on-accent #14243a`** = tinta navy sobre
naranja, AA 5.6:1), estados (`--success #067647`/`--success-bg #ecfdf3`, `--warning
#b54708`/`#fffaeb`, `--danger #b42318`/`#fef3f2`, `--info #175cd3`/`#eff8ff`),
`--dot-*`, `--nav-bg #0f1f33`, sombras (`--shadow-sm/--shadow/--shadow-md/--shadow-lg/
--shadow-pop`), foco (`--focus-ring` halo navy 4px), **vidrio** (`--glass-bg/-border/
-shadow/-blur`, blur 20px saturate 180 %), tipografía (`--font-body Inter`,
`--font-display Inter Tight`, auto-hospedadas, mismos woff2), escala fs 12→32.
Oscuro: brand `#2e75b6` (relleno con texto blanco AA 5:1), accent `#fb923c`, etc.

## Divergencias DELIBERADAS (documentadas, NO igualar)
| Token | App | Web | Motivo |
|---|---|---|---|
| `--radius-sm` | **10px** | 8px | Objetivos de campo con guantes (BH5) |
| `--radius` | **14px** | 10px | idem |
| `--radius-lg` | **18px** | 16px | idem |
| `--radius-xl` | 24px | 24px | (igual) |
| `--transition` | **`0.15s ease`** (fragmento) | `all 0.2s ease` | Se usa como `transition: transform var(--transition)` en option-button/pin-pad/big-button/step-bar → NO puede llevar `all` (quedaría inválido). BH5. |
| Arquitectura shim | `--color-*` = fuente, semántico = alias | semántico = fuente, `--sgc-*` = alias | La app **no migró** sus 194 componentes; se invierte el shim a propósito (BH5). |
| `bottom-sheet` radio | 28px (one-off) | — | Hoja inferior de la app (mock CB). |

## Amber histórico
`--Hub` (#ffb300, ex-marca) ahora es **alias de `--accent`** (naranja) para no romper
sus 131 referencias (§E). Paridad de intención: una sola marca + un acento.

## CC (ronda 29-30/09/2026) — decisiones de paridad app↔web
- **CC4 · Importar datos desde Odoo (proveedores/vehículos/artículos): SOLO WEB.** Es
  trabajo de escritorio (subir un `.xlsx`/`.csv` exportado de Odoo, mapear columnas,
  previsualizar transformaciones, deshacer). La app de campo **no lo lleva** (regla del
  proyecto: la app no es un mini-SGC). El asistente vive en la web (Compras/Flota/
  Inventario, según el gate de entidad). — *Sin equivalente en la app, a propósito.*
- **CC6 · N.º de recibo en la echada:** la app **captura** `numero_recibo` y lo guarda
  en el borrador y el registro local; el envío lo manda **detrás de comprobación de
  capacidad** (el `registrar_combustible_app` del padre aún **no** tiene el parámetro
  `p_numero_recibo` — hueco anotado). Cuando el padre lo añada, se persiste solo.
- **CC8 · Órdenes de trabajo:** la app ya usaba el RPC definer `orden_trabajo_detalle`
  (no toca `bitacora_orden_detalle` directo); el bug era de grants en la web (lo arregló
  el padre). Sin cambios en la app.

## CD (ronda 30/09/2026) — decisiones de paridad app↔web
- **CD3/CD4/CD5 · Flota del chofer (app 2.37.0):** *Mi vehículo* ya usa el criterio
  correcto (asignación vigente ∪ uso abierto; el uso-v2 manda) y el padre cierra los usos
  huérfanos > 24 h → la app lo **refleja** solo (el vehículo desaparece de "en uso") y
  **avisa** por la notificación `flota_uso_cerrado` del padre (deep-link nuevo → `/transporte`).
  *Mantenimientos* pasa a `listar_mantenimientos` (definer/paginado/índices) en vez de
  lectura bajo RLS (arregla el timeout, CD4). *Combustible*: el chofer ve *Echadas del
  vehículo* asignado (no solo las suyas) gracias a la política CD5 del padre; el KPI de la
  ficha se llena por la misma vía. No se creó RPC nuevo de KPI: el padre lo resolvió por
  **política RLS** (regla 14, un solo predicado `puede_ver_vehiculo`).
- **CD7 · Requisición (pendiente único):** la app ya leía `pendiente` del servidor
  (`requisicion_avance`, nunca cálculo local). Ahora el RPC expone `cubierto` e `item_id`
  y `pendiente = solicitado − despachado − cubierto`; la app añade el chip **"Cubierto por
  llegada · n"** y cuenta como completado el renglón cubierto. *Deshacer* = quitar la
  cobertura (RPC `desvincular_cobertura`) si el usuario puede gestionar.
- **CD8 · Idempotencia del reenvío:** `client_uuid` estable (`uuidV5('reenvio:<id>')`) en
  todos los envíos de la misma echada rechazada → el servidor nunca duplica el reenvío.
  Aviso suave de posible duplicado (recibo repetido / echada casi igual ±2 h · ±0.5 %),
  online, que **no bloquea offline**. Ver `docs/REVISION-COMBUSTIBLE-2026-09.md` (lado app).
- **CD1 · Tarjetas de *Flota de Vehículos*: DIVERGENCIA DELIBERADA.** El bug de la web
  (fila *Ver perfil · Editar · switch* a alturas distintas, sin pie fijo) **no existe en
  la app**: la app **no** replica ese patrón de tarjeta con pie de acciones. Su lista de
  flota (`transporte/vehiculos`, `shared/ui/vehiculo-card`) es una **fila tocable** (un
  tap = abrir la ficha; una regla del proyecto), sin *Editar*/switch por tarjeta —
  `vehiculo-card` es un row flex (`align-items:center`) con slot `trailing` para un badge/
  CTA, ya alineado. El rediseño de tarjetas de CD1 es **solo web**. — *A propósito.*
- **CD2 · Auditoría: SOLO WEB.** La app no tiene pantalla de *Auditoría* (filtros/tabla/
  date-picker). — *Sin equivalente en la app.*
- **CD6 · Historial de versiones → GitHub: SOLO WEB.** La app tiene su historial de
  versiones (admin → *Versiones*, `pages/admin/versiones`, lee `app_versiones`) pero
  **no enlaza a GitHub** ni abre deployments antiguos (0 referencias a `github` en `src/`).
  El bug de "Abrir esta versión → GitHub" y la galería/`deploy_url` son **solo web**. — *A propósito.*

## Ronda CE (01/10/2026) — app 2.38.0
- **CE14 · Aprobar echadas desde la app (arreglo).** La causa NO era el gate del servidor
  (Raykler tiene rol `logistica`; `aprobar_echada`/`rechazar_echada` aceptan "Logística o
  admin" y él pasa). Era **layout en Safari/iPhone**: las fotos de *Por aprobar* usaban
  `app-img ratio 1/1` dentro de un grid, y iOS **no honraba el aspect-ratio** → se
  renderizaban a su alto natural (verticales), desbordaban la tarjeta y tapaban el pie de
  acciones. Fix: **tira horizontal de miniaturas de alto FIJO (80 px, object-fit cover)**
  con toque → visor a pantalla completa; el pie *Aprobar · Aprobar con corrección ·
  Rechazar* (52 px) siempre visible. La decisión sigue por outbox (offline). — *Igual que
  la intención de la web; el bug era solo del cliente móvil.*
- **CE12/CE13 · Spec de combustible por vehículo (mejora).** La alerta de rendimiento usa
  `spec_combustible(p_vehiculo)` del padre (rango propio → clase → global + unidad) y
  **dice de dónde viene el rango** ("rango del vehículo / de la clase / global"). Unidad
  **h/gal** para equipos por horas. **Detrás de comprobación de capacidad**: si el RPC no
  está, cae al rango global (constantes `REND_MIN/MAX_KM_GAL`) — comportamiento previo
  intacto. **Los umbrales se EDITAN EN LA WEB**; la app solo los lee (sin pantalla de
  umbrales ni de spec por vehículo en el móvil). — *Divergencia deliberada: edición = web.*
- **CE2 · "Registró" visible (arreglo).** La lista usa el RPC definer
  `listar_personal_obra()` que resuelve `registrado_por_nombre` para cualquier rol (antes
  el embed a `usuarios` bajo RLS volvía null para Legal). Fallback al select directo si el
  RPC no está. El expediente enriquece el nombre desde el cache de la lista.
- **CE4 · Registrar sin foto (mejora).** Las 5 fotos son opcionales en el wizard; chip
  *Falta foto* en el resumen y en el expediente; **añadir foto después** desde el
  expediente (cámara → outbox `personal_foto`).
- **CE6 · Foto negra (arreglo).** `comprimir-imagen.util` ahora: HEIC→JPEG con `heic2any`,
  **fondo blanco antes de exportar** (transparencia → blanco, no negro) y **validación de
  monocromo** (no se guarda un cuadro negro). Misma función para las 5 fotos (paridad web).
- **CE11 · Fecha legible (arreglo).** La lista usa `formatFechaHumana` para `created_at`;
  `formatFecha` se volvió defensiva (si llega un timestamp con `T`/`Z`/`+`, delega a
  `formatFechaHumana`).
- **CE16 · Duplicado por documento (nuevo).** Aviso suave al registrar vía
  `personal_obra_doc_existe(p_tipo, p_numero, p_exclude)` (no bloquea; best-effort).
- **CE3/CE5 · Carnet (nuevo).** Logo **blanco** en la banda navy del carnet en pantalla
  (asset `csd-no-bg-logo-white.png`, copiado del padre). **Compartir / Imprimir carnet**:
  PDF **CR80 real (85.6×53.98 mm), frente y dorso** con jsPDF, QR a la MISMA URL pública
  de la web (`/verificar/<carnet>`), compartido por el share-sheet (nativo/PWA). Registra
  la reimpresión (`registrar_reimpresion_carnet`, best-effort). *A4 con 8 = diferido
  (igual que la web).* — *Paridad de diseño; el móvil genera el PDF con jsPDF porque no
  tiene ventana de impresión.*
- **CE10 · Avisos de requisición a miembros de la obra: SERVIDOR (padre).** El emisor usa
  `sgc.es_miembro_obra()` (verificado vivo en dev); la app solo **recibe** la notificación.
  Sin cambio de cliente. — *Owned by SGC.*

## Ronda CF (02-03/10/2026) — app 2.39.0
- **CF4 · Lectura automática del recibo (nuevo).** Al tomar/subir la foto del recibo (y
  tablero), con red la app llama a la edge `leer-recibo` (visión, misma API key que Compa),
  comprime a ~1600 px y rellena monto/galones/producto/estación/Nº recibo/km/tarjeta con
  confianza ≥ 0.9 (chip *Leído del recibo*); el chofer confirma/corrige, nunca se envía
  solo. Banda *No coincide con el recibo* si lo confirmado difiere > 2 %. *Volver a leer*.
  Sin red no se lee (la foto queda en el borrador). `CombustibleService.leerRecibo()`.
  - **CF4 F1.2 · Lectura al reconectar (2.41.0).** Si la foto del recibo se toma **sin
    señal**, queda *pendiente de leer*: un `effect` sobre `network.online()` dispara la
    lectura en cuanto vuelve la red (también al recuperar un borrador sin datos), y
    **solo rellena los campos vacíos** (no pisa lo escrito a mano). Mientras no hay señal,
    pista *"Leeremos el recibo cuando vuelva la señal"*; con foto sin leer, botón *Leer
    recibo*. Cierra el punto 2 de la spec (antes solo se leía al capturar con red).
- **CF5 · Solicitud de movimiento con almacenes y catálogo (mejora).** Origen/destino con
  selector de **almacén (Central primero)** u obra, y **renglones del catálogo cacheado**
  (offline) con cantidad y unidad + *no catalogado*. El outbox llama a
  `crear_solicitud_movimiento_v2` (p_items + bodega/proyecto; compatible con payloads
  viejos del outbox). — *Contrato del padre (PROMPT-80), vivo en dev+prod.*
- **CF2 · Lista de personal.** Ya cumplía desde CE (fecha+hora legibles en una línea con
  `formatFechaHumana`, pendientes como chips con filtro rápido). Sin cambios. — *Paridad OK.*
- **CF3 / CF6 · Web-only.** Modales compartidos y aprobaciones legales viven en el padre. — *Owned by SGC.*
- **CF1 · Firma empleador/testigos ACTIVADA en la app (nuevo).** Xaviel activó la firma
  (`FIRMA_HABILITADA=true`). El trabajador firma en el wizard (outbox); al crear
  `personal_obra_firmas` el handler **siembra** las líneas (empleador + 2 testigos,
  `sembrar_lineas_firma`). En el **expediente**, por documento se ven las líneas por rol
  con su estado y, para legal/gestión, **Registrar firma** (*ahora* pad / *en papel* foto o
  PDF; testigos con nombre+cédula) vía `firmar_linea_documento`, y **Subir documento
  firmado** (`camera.pickDocument`). Online. — *Paridad con la web (prod).*
- **CF7 · Plantilla por defecto en la app = diferido.** La app firma por **nombre libre**;
  no renderiza la plantilla Word. Los contratos formales de Sonia se generan/renderizan en
  la **web** (prod). Follow-up: portar `plantillas-documento.service` (getAll+renderizar)
  a la app si se quiere generar el contrato desde el teléfono. — *Diferido.*

## Ronda CG (05-oct) — app 2.42.0

- **CG6/CG7 · Chofer privado (nuevo).** El rol `chofer_privado` se separa del de flota
  (`esChoferFlota` vs `esChoferPrivado` en `user-context.service`). En Transporte el privado
  ve SOLO su lista blanca (uso de vehículo, combustible, inspección, aviso y mantenimientos);
  **no** ve conduces, despachos, rutas, incentivo ni *Mi rendimiento*. Los RPC `mis_*` del
  chofer ya son self-scoped (el servidor no le devuelve conduces/rutas), y los avisos los
  decide el servidor. El **selector de vehículo** (uso/combustible/inspección) sale de la
  única fuente `getVehiculosDisponiblesDetailed()`, que ahora **recorta a los autorizados**
  (`vehiculo_autorizaciones`, RLS propia, cacheado offline, vigencia en cliente) cuando es
  privado; si no tiene ninguno → *"Aún no tienes vehículos autorizados — pídeselo a Flota"*.
  — *Contratos del padre (PROMPT-82) vivos en dev: `puede_ver_vehiculo(p_vehiculo,p_usuario)`,
  `vehiculo_autorizaciones`, `autorizar_vehiculo_privado`, `listar_autorizaciones_vehiculo`.*
  **Autorizar/retirar un vehículo a un privado se hace en la WEB** (ficha del vehículo/conductor,
  admin/flota-elevado) — web-only; la app solo consume. — *Paridad: app consume, web gestiona.*

- **CG13 · Mantenimientos en la app + PDF (nuevo).** Tile *Mantenimientos* (flota elevado +
  privado scopeado) → módulo general (`transporte/mantenimientos-general`): lista de toda la
  flota (`listar_mantenimientos` sin vehículo, cacheada), filtros (vehículo, tipo, estado,
  taller, fecha) en cliente, *Nuevo* (elige vehículo → registrar) y *Cerrar*. **Adjuntos
  imagen + PDF** (`mantenimiento_adjuntos`, bucket `vehiculos`): se adjuntan al **crear** (paso
  de evidencia del wizard, con tipo de documento) y **después** desde el historial/lista;
  offline por outbox (`tipo_op: mantenimiento_adjunto`, idempotente). Se **abren dentro del
  sistema** con el `pdf-viewer` (PDF) o lightbox (imagen) vía `app-mant-adjuntos`, desde el
  historial por vehículo y la lista general. **Tope 15 MB** (límite real del bucket; la spec
  pedía 20 MB → *pendiente del padre: subir `file_size_limit` del bucket `vehiculos` a 20 MB*).
  — *Contratos del padre vivos en dev: `mantenimiento_adjuntos` + `listar_mantenimientos` con
  `adjuntos[]`.* **`editar_mantenimiento_app` NO existe** → la app no edita un mantenimiento
  (solo crear/cerrar/adjuntar); editar queda **web-only** hasta que el padre publique el RPC.

- **CG4 · Login "Con cédula" (ya cumplía).** El login de la app ya tenía pestañas *Con correo*
  / *Con cédula* (sin "Soy conductor"). Se quitó la palabra "conductor" del texto de ayuda. — *OK.*

- **CG3 · Máscara de cédula (nuevo).** Directiva `appCedulaMask` (`shared/ui/cedula-mask.directive`)
  formatea `000-0000000-0` mientras se escribe (re-dispara `input` para no pelear con
  `[ngModel]` de una vía). Aplicada en: login (ya lo hacía a mano), conductor, asignar acceso,
  orden de trabajo (ingeniero + cliente) y personal de obra (solo cuando el tipo es cédula;
  pasaporte/extranjera sin máscara). El servidor normaliza, así que el guion es solo visual. — *Paridad con la web.*

- **CG5 · Alta por cédula (sin pantalla en la app).** La app NO crea usuarios por cédula (eso
  es web); solo **otorga acceso** a una ficha existente (`conductor-crear-acceso` / `acceso-cedula`,
  con mensajes humanos) e inicia sesión por cédula (`conductor-login`, fetch propio que ya
  degrada: 401 "Cédula o PIN incorrectos", 429 rate-limit, red → reintento; nunca el crudo
  "Failed to send a request…"). — *Web-only la creación; app ya robusta en errores.*

- **CG2 · Importar personal con cargos (web-only).** El import masivo con alias de cargo
  (`cargo_alias`) y la detección de `permiso_vencimiento` son de **escritorio** (Excel, drag &
  drop). La app registra personal **uno por uno** eligiendo el cargo de un selector (ya manda el
  `cargo_id` correcto, sin necesidad de alias). Capturar `permiso_vencimiento` en el registro de
  la app queda como follow-up. — *Web-only (import); app OK con cargo por selector.*

- **CG8/CG9/CG10/CG11/CG12 · Gestión de conductores/usuarios (web-only).** "Hacer conductor",
  el `user-picker` con búsqueda, autollenado desde el perfil, arrastrar y soltar en adjuntos y la
  fusión de usuarios duplicados son features de **Admin en la web** (escritorio). En móvil los
  adjuntos siguen con cámara/galería/archivo. — *Web-only; anotado.*

---

## Tanda CI (07/10/2026) — app lista para tiendas (PROMPT-87)

### Contratos del padre que la app CONSUME (verificados vivos en sgc-dev)
- `politicas_pendientes()` → filas `{documento, version}` · `aceptar_politica(p_documento, p_version, p_plataforma)` → `PoliticasService` (CI3; pantalla de aceptación bloqueante en el shell).
- `solicitar_eliminacion_cuenta(p_motivo, p_plataforma)` → `PoliticasService.solicitarEliminacion` (CI4; Perfil › Privacidad).
- `mi_consentimiento(p_tipo)` / `set_consentimiento(p_tipo, p_otorgado, p_plataforma)` → `ConsentService` (CI10 ia / CI5 ubicacion_fondo). Las edges `assistant`/`leer-recibo`/`transcribe-now` responden **403 `sin_consentimiento_ia`**; la app gatea ANTES (IaConsentGate) y degrada legible.
- `mi_config_tracking()` ahora devuelve `estado` + `rastrear` (= comparte && estado≠inactivo). `TrackingService` prefiere el estado LOCAL (offline-first) y usa `rastrear` de respaldo.
- `sgc.parametros.play_store_url` / `app_store_url` → `TiendasService` (CI7/CI8).
- Rol `revisor_tiendas` (id 39) → cuenta demo del revisor (CI11, data-fix del padre).

### Divergencias / notas de paridad CI
- **Canal de actualización** (app): flavors `play`/`apk` (+ `appstore`/`pwa` en environment.canal). La web no tiene canal (siempre PWA). `UpdaterService` ramifica por canal.
- **Prominent disclosure de ubicación** (CI5): existe solo en la app (es requisito de las tiendas de apps nativas). La web no rastrea en segundo plano.

### GAPS del padre pendientes (reportar / confirmar)
1. **Lectura de `parametros.play_store_url`/`app_store_url` por usuario autenticado.** El `anon` NO puede leer `sgc.parametros` (42501). La app lee **autenticada**; si el rol `authenticated` tampoco tiene grant/RLS para esas claves, `TiendasService` degrada a null (sin avisos) — **cero regresión hoy** (URLs vacías). Si al poblar las URLs la app no las ve → el padre debe dar `GRANT SELECT` + RLS para esas claves, o exponer un RPC público. (Verificar cuando Xaviel pegue las URLs.)
2. **iOS `transcribe-now` con `audio/mp4`** (WKWebView graba mp4): verificar que la edge lo acepte al activar iOS; si no, convertir en cliente o ajuste del padre.
3. **Alarma dominical en iOS**: pendiente `@capacitor/local-notifications` semanal (equivalente de AL6) al activar iOS (`docs/TIENDAS-IOS.md`).

## Ronda CK (PROMPT-91, 09/10/2026) — contratos + paridad + huecos del padre
**App 2.46.0.** Consume contratos de PROMPT-90 (SGC 1.159.1/1.160.0/1.161.0, vivos en dev/prod).

### Contratos consumidos (servidor = fuente de verdad)
- **Notificaciones (CK10):** canal nativo único **`avisos_csd_v2`** (constante en `src/app/core/constants/notif.ts` = `MainActivity.PUSH_CHANNEL_ID` = manifest `default_notification_channel_id` = `send-push android.notification.channel_id`). "Probar notificación" = `probar_notificacion()` → `{dispositivos}`, resultado por `mis_notif_entregas(p_limite)` (estados `enviada|omitida|fallida`, motivos `sin_dispositivo|fcm_apagado|dev_push_off|token_vencido|error:<n>`).
- **Entregar a (CK4):** `conduce_asignar_receptor(p_salida_id,p_usuario_id,p_forzar)`; receptor designado = `conduce_detalle_app().firma_pendiente_nombre`; picker = `receptores_disponibles` + `buscar_usuarios` (forzar, elevados).
- **Echada galería (CK3):** `registrar_combustible_app(... p_foto_origen)` 22-arg; `registros_combustible.foto_origen ∈ camara|galeria`.
- **Apoyo de transporte (CK11-13):** `apoyo_transporte_crear/_agregar_foto/_cambiar_estado/_listado/_detalle`, `puede_ver_apoyo`; cols `solicitudes_movimiento.{tipo_apoyo,dia,descripcion,retiro_material_id}`; bucket `apoyo-transporte`. Estados `pendiente→asignada→en_proceso→por_confirmar→completada|cancelada`.
- **Trabajos (CK14-16):** `trabajo_evento_chofer(p_origen,p_origen_id,p_evento,...)` eventos `en_camino|llegue|trabajando|termine|problema`; `trabajos_transporte_listado`, `trabajo_asignar`, `actividad_crear`, `mis_choferes_panel`. `chofer_estado` lo gobierna el server dentro de `trabajo_evento_chofer` (la app NO lo re-setea).

### Huecos del padre (la app degrada / no pinta; SQL dejado en `sql-para-sgc/`)
1. **`2026-10-09-ck14-mis-trabajos-chofer.sql`** — el chofer NO tenía lectura (`trabajos_transporte_listado`/`puede_ver_apoyo` gatean a elevado). Añade `mis_trabajos_chofer(p_dia)` + extiende `puede_ver_apoyo` al chofer asignado (cuerpo vivo verificado idéntico + 1 cláusula). **Sin esto, "Mis trabajos" sale vacío y la foto de "Terminé" reintenta en el outbox.**
2. **`2026-10-09-ck15-misael-acciones.sql`** — "Ordenar" (col `orden`/`orden_transporte` + `trabajo_ordenar`) y "Nota para el chofer" (`solicitudes_movimiento.nota_chofer` + `trabajo_asignar` 6-arg) no tienen hogar. La app no pinta esos botones (capability). `trabajo_asignar` recreado = cuerpo vivo idéntico + adiciones.
3. Alertas §CK16.4 #2/#3 (en-camino >2h, problema sin atender) y cancelar no-apoyo: `mis_choferes_panel` no expone `ultimo_evento`/`problema_pendiente` → pendiente del contrato.
4. Renglones cf5 de solicitudes viejas: `apoyo_transporte_detalle` no los expone → no se ven en el detalle nuevo.

### data-testid estables (guiones de video CK5)
combustible-wizard · uso-vehiculo · crear-ruta · preuso-checklist · bitacora-parte · recibir-conduce · requisicion-pedir · compa · crear-apoyo · apoyo-listado · apoyo-detalle · mis-trabajos · trabajos-transporte · mis-choferes · (+ `guia-video-<id>` por video).

## Ronda CL (PROMPT-93, 09-10/10/2026) — app 2.47.0
Ronda de motion + bienvenida (consume PROMPT-92 del padre, parcialmente shippeado).

### Nuevo en el app (contrato a espejar / notas)
- **Canal (CL4):** se inyecta por `src/environments/canal.generated.ts` (gitignored, FUERA de `fileReplacements`); candado de build `scripts/lib/canal.mjs` aborta si el binario no trae `canal:"<esperado>"`+`version:"<v>"`; fallback runtime en `UpdaterService.resolverCanal()`. **Recordar: `environment.prod.ts` + `environment.dev.ts` + `build.gradle` llevan la versión a mano — alinear los 3 cada ronda.**
- **Motion (CL2):** 8 directivas en `src/app/shared/motion/` (appStagger/appCountUp/appFadeIn/appTabIndicator/appEstadoPulse/appWizardStep/appShake/appTapScale) + `MotionService.momento(tipo)` + `app-momento` (sin velo) + `celebrar()` (de CJ). Registro `src/app/core/motion/catalogo-movimiento.ts` (misma forma que `sgc.movimiento_catalogo`). Aplicado en TODA la app. La **web (PROMPT-92) debe espejar** el contrato `momento()` + ids/tiempos del catálogo.
- **Bienvenida (CL3):** `BienvenidaService` unifica idioma/políticas/ubicación/notificaciones en un flujo (conserva sus registros); gate local `bienvenida_v2:<u>` + servidor `bienvenida_app_v2_vista` (capability). "Ver otra vez" en Soporte; hatch `?bienvenida=1`.
- **Catálogo (CL5/F6):** `scripts/data-fixes/2026-10-10-cl5-movimiento-catalogo-app.mjs` upsertea las 4 filas `sistema='app'` (exclusivas) en `movimiento_catalogo` (aplicado en dev). **Mapeo de taxonomía:** el app usa nivel 'simple'/'sistema' + sistema 'web-app'; la tabla del padre exige nivel ∈ grande|mediano|base y sistema ∈ web|app → el script mapea (simple/sistema→base, web-app→app). Las filas 'web-app' compartidas las publica la **web** (padre).

### Huecos del padre (pendientes)
- **🔴 CK (ronda anterior):** `mis_trabajos_chofer` + `trabajo_ordenar` + extensión de `puede_ver_apoyo` al chofer + `nota_chofer`/`trabajo_asignar` 6-arg — **siguen 404 en dev/prod** (`sql-para-sgc/2026-10-09-ck14*/ck15*`). Hasta aplicarlos, "Mis trabajos" del chofer sale vacío.
- **CL:** la web debe publicar sus filas ('web' + 'web-app') en `movimiento_catalogo` y espejar el contrato de `momento()`.

## Ronda CM (PROMPT-95, 11-12/10/2026) — app 2.48.0
Consume PROMPT-94 del padre. **Envía F1/F2/F4/F5** (F3/F6 quedan como follow-up — ver huecos).

### Contratos del padre consumidos (verificados vivos en sgc-dev)
- **Transferir/firmar por fase (F1 CM4):** `conduce_puede_transferir(p_conduce_id)` → `{puede,motivo}` + `conduce_fase` en `conduce_detalle_app()`. La app ya **no** deduce `pendiente_firma` de `firma_pendiente_usuario_id`: usa la fase del server. "En camino — podrás firmar cuando el chofer lo entregue" con botón apagado en conduces-pendientes/por-confirmar.
- **Logo (F4 CM2):** `src/assets/imgs/logos/csd-logo-simbolo.svg` (copiado idéntico del padre). `csd-logo-texto.svg` **aún no existe** → el texto "CSD APP" se pinta como texto (no bloquea).

### Nuevo en el app (F2/F5)
- **Visor de foto de perfil (F2 CM5):** `shared/ui/photo-viewer` global (service + host en app.html). Avatares CON foto en conductores/perfil-conductor/perfil/mi-detalle/mensajes/personal-expediente/compa la abren. `comprimir-imagen.util.ts` avatar.maxLado 512→**1080** (paridad web).
- **Reproductor de video (F5 CM3):** `shared/ui/video-player` global (service + host en app.html) — teatro a pantalla completa: play/pausa, sonido, barra arrastrable, **CC** (si hay .vtt), **velocidad** (1×→2×), **pantalla completa** (Fullscreen API → gira a horizontal en Android), **capítulos** en hoja inferior. Offline = no abre (avisa). "Aprende viendo" (rejilla con chips por módulo) + videos de instalación arriba en "Primeros pasos" con "Compartir por WhatsApp" — todo en **Tecnología › Dudas** (`/tecnologia?tab=dudas`). Datos de `sgc.ayuda_contenido`; campos nuevos OPCIONALES del padre: `kicker`, `capitulos[]`, `instalacion ∈ android|iphone`, `compartir_url`.
- **Modo grabación (F5):** `TutorialModeService` + `?tutorial=1` → `CameraService.takePhoto` devuelve una foto demo (canvas). 🔒 **Candado:** nunca activo en prod (`environment.entorno==='prod'` lo apaga aunque venga la bandera).

### data-testid estables (guiones de video, F5 §1)
Guiones `app-preuso`/`app-combustible`/`app-uso-vehiculo`:
- **preuso:** `preuso-checklist` (contenedor) · `preuso-next-datos` · `preuso-next-fotos` · `preuso-next` · `preuso-submit`.
- **combustible:** `combustible-wizard` (contenedor) · `combustible-km` · `combustible-leer-recibo` · botón primario del pie = `[data-testid="combustible-wizard"] .wizard-footer__primary`.
- **uso-vehiculo:** `uso-vehiculo` (contenedor) · `uso-soltar` · `uso-cta` (tomar/guardar).
- **videos:** `guia-video-<id>` (card de "Aprende viendo") · `instala-video-<id>` · `guia-vbtn-<id>` · `video-player-el` (el `<video>` del reproductor).
- Los de CK5 siguen: crear-ruta · bitacora-parte · recibir-conduce · requisicion-pedir · compa · crear-apoyo · apoyo-listado · apoyo-detalle · mis-trabajos · trabajos-transporte · mis-choferes.

### F3 (CM6) + F6a (CM7) — DESBLOQUEADAS y cableadas (app 2.49.0)
El padre aplicó PROMPT-94 F3+F7a (verificado vivo en **dev y prod**). Consumido:
- **Incentivos con tope (F3):** `incentivo_config_actual()` → `{maximo_semanal, topes}`; `incentivo_semana.{maximo,puntaje_bruto}` expuestos por `incentivo_listado`/`incentivo_mi_rendimiento`. App: gestión muestra el tope (read-only, "se configura en la web") + por chofer puntos hechos/cuentan/"N sobre tope"; Mi rendimiento barra vs tope + "Llegaste al tope…". Campos opcionales (capability: no-op si el server no los expone). Config de topes = **solo web**.
- **Modo práctica (F6a+F6b — completo):** `practica_guardar_intento(p_mision_id,p_nota,p_estrellas,p_aprobada,p_duracion_s,p_detalle,p_plataforma,p_version)` + `practica_resultados_persona(p_usuario_id)` + tabla `practica_misiones`. **Aislamiento por construcción:** el simulador vive en `core/practica/` y NO toca outbox/borradores/Dexie/Preferences; la única salida a red es `practica_guardar_intento` (online, best-effort) → offline = **cero sincronizaciones**. Push/GPS/tracking no se activan. **9 misiones** registradas en `sgc.practica_misiones` (plataforma='app') vía `scripts/data-fixes/2026-10-12-cm7-seed-misiones-app.mjs` (dev aplicado; **prod lo aplica el padre**): `app-combustible` (intro), chofer (`app-preuso`/`app-uso-vehiculo`/`app-conduce`/`app-reporte-estado`), ingeniero/capataz (`app-parte-diario`/`app-pedir-material`/`app-recibir-conduce`/`app-apoyo-transporte`). Escenarios (objetivos/puntos) en el CLIENTE (`misiones-app.ts`); el motor es data-driven (pasos `valor`/`foto`/`accion`/`confirmar`, reglas de puntos por objetivos + bono de tiempo + penalizaciones por trampa). `misionesVisibles()` = admin todas / resto por rol. "Mis resultados" por `practica_resultados_persona`.
- **testids práctica:** `soporte-practica` · `practica-mision-<id>` · `practica-avanzar`.

### Huecos / pendientes CM
1. **Logo texto (F4):** `csd-logo-texto.svg` ya existe en el repo (sin cablear al reveal; el reveal usa "CSD APP" texto — refinamiento menor).
2. **bienvenida CL3:** falta añadir "Modo práctica" como último paso (hoy entra por Soporte).
3. **prod:** el padre debe aplicar `cm7-seed-misiones-app` en **prod** (sin eso, guardar la nota de práctica falla en prod).

## Ronda CO (PROMPT-99, 14-16/10/2026) — app **2.51.0 PUBLICADA A PROD** ✅
Consume PROMPT-98 del padre — **ya mergeado a `SGC` main** (`f755dbf`, web 1.189.0; contrato completo en `SGC/PARIDAD.md` sección "Tanda CO" — esa es la fuente autoritativa, no la copiamos aquí). Las 19 RPCs/tablas que esta ronda necesita están **LIVE en sgc-dev y sgc-prod**.

**Release real (16/10):** `dev`=`feature/co-ronda`=`3862f43` → **PR #1** (`techcsd/csd-app`, check `build-prod`+Vercel verdes) → merge `c689d0f` → Vercel construyó `app.` (prod PWA). **APK prod 2.51.0** firmado (cert `3c5316d8…5065`), candado canal/versión OK, regla 18 OK (ya había salido en dev con prueba real de actualización in-app en un Samsung). Subido al bucket prod + `apk_url` + registrado. **PUBLICADA** (2.50.0 despublicada, **mínima sigue 2.45.0**, no forzado) + **11 iPhone (ios-pwa) notificados**. Xaviel probó la actualización de la PWA en su iPhone (2.50.0→2.51.0) antes del OK a prod.
- **Bug encontrado y corregido durante el release:** `scripts/release-apk.mjs` nunca actualizó `CAMBIOS_CURADOS`/`TITULO` para esta ronda — la fila 2.51.0 quedó registrada (dev y prod) con el changelog literal de 2.50.0, que es justo lo que Novedades (CO2) y el push de versión usan. Corregido vía **PR #2** (`cee41ce`, mergeado a `main` y sincronizado de vuelta a `dev`): constante arreglada + data-fix versionado (`scripts/data-fixes/2026-10-16-co-corregir-changelog-2.51.0.mjs`) que corrige la fila ya registrada (UPDATE directo, `registrar_version` es enriquecedor y no sobrescribe) y las 13 notificaciones que ya habían salido con el texto viejo. El push FCM que ya le llegó a ~12 android con el texto viejo no se puede recordar (cosmético: título genérico correcto, cuerpo de otra versión) — Novedades y el inbox ya muestran el changelog real.

### Cerrado y EN PROD (FASES 1-3)
- **CO1 (updater PWA):** `VersionService.fetchRpc()` llama `version_publicada(p_plataforma)` con `'ios-pwa'|'movil'` (antes 0-arg); nuevo `debeActualizarPwa()`. `UpdateService` escucha `VERSION_INSTALLATION_FAILED`/`unrecoverable` → auto-repara (unregister SW + borra `caches`, nunca IndexedDB) + reporta a `app_error_reports` tipo `sync`. `registrationStrategy: registerImmediately`. `ngsw-config.json` core prefetch 9 MB→~200 KB. "Reparar la app" en Perfil + `/actualizar`.
- **CO3/CO5/CO16 (duplicados):** bandera `submitting`/`busy` movida a la primera línea en 8 sitios (combustible, generar-conduce ×3, crear-ruta, conduces ×2, devolver-material, por-confirmar, compa ×2, conteo). Guard de build `scripts/verify-envio-unico.mjs` (portado del padre) en `prebuild`. El `{duplicado:true}` del servidor ya se trata como éxito (ningún cambio de cliente necesario: no hay check de error).
- **CO4:** `SolicitudesService.puedeAutoaprobar()` (RPC `puede_autoaprobar_requisicion`) → `detalle.ts` lo sube a `puedeAprobarORechazar`; chip "Aprobada por su autor" (`RequisicionDetalle.autoaprobada`, campo opcional).
- **CO9:** `ApoyoListadoRow` gana `cancelada_por_nombre/cancelada_at/motivo_cancelacion/completada_por_nombre` (campos opcionales de `apoyo_transporte_listado`) pintados en la tarjeta; `apoyo-detalle` gana "Cambiar estado" (transporte elevado/admin, solo en completada/cancelada, nota obligatoria) vía el mismo `ApoyoService.cambiarEstado()` que ya existía.

### CO10/CO17 (Web Push) — cerrado, **en prod**
Cliente completo: `core/services/push-web.service.ts` (SwPush + VAPID + alta/baja de suscripción) + `notif-health-band` con los 4 casos reales (default/denied/no-instalada/no-soportado) + `notif-health.service.ts` exige suscripción ACTIVA (no solo permiso) en PWA.
**Confirmado y resuelto el riesgo documentado antes:** el payload `{title,body,url}` de `send-push` NO calza con lo que `ngsw-worker.js` de Angular espera (`{notification:{...}}`) — sin arreglo, el push llega pero Angular nunca lo pinta. Se resolvió con `public/push-sw.js` (capa que hace `importScripts('./ngsw-worker.js')` y pinta la notificación ella misma para el formato plano del padre); `app.config.ts` registra `push-sw.js` en vez de `ngsw-worker.js`. También se encontró y corrigió una llave VAPID vieja/huérfana en `.env.local` (CF4c) que no coincidía con el par real que el padre configuró en sgc-dev hoy.

### CO2 (Novedades) — cerrado, **en prod**
`core/services/novedades.service.ts` + `shared/components/novedades/`. Orden logo→bienvenida→novedades→app garantizado vía `BienvenidaService.decision` (promesa que resuelve una vez, ya existente) + espera a `!navGuard.formActivo` antes de mostrarse (mismo patrón que usa `UpdateService` para diferir su recarga). "Ver historial completo" reutiliza `VersionService.historial()` (RLS `using(true)`, cualquier autenticado puede leerlo) en vez de abrir una ruta admin-only nueva.

### CO8 (Compras tec, lado app) — cerrado, **en prod**, con un hueco real encontrado en el padre
`core/services/compras-tec.service.ts` + `pages/tecnologia/compras-tec/` (entrada nueva en el hub Tecnología). Solo la parte del aprobador (ver + aprobar/rechazar con vista previa PDF/imagen), tal como pedía el prompt.
**Hueco de RLS en el padre:** la policy de SELECT de `sgc.solicitudes_compra` es `solicitante_id = auth.uid() or is_admin() or tiene_modulo('compras')` — **no incluye `aprobador_id = auth.uid()`**. Si Eduardo Ng (el aprobador configurado en `parametros.compras_tec_aprobador`) no tiene el módulo `compras` ni es admin, ni esta pantalla ni la de la web le muestran nada, aunque `compra_tec_decidir` SÍ lo autorice a decidir (ese RPC chequea `aprobador_id` correctamente). Arreglo: añadir `or aprobador_id = auth.uid()` a esa policy (1 línea, `sql-para-sgc`).

### CO13/CO11/CO12 (Legal + Documentos) — cerrado, verificado en vivo contra sgc-dev, **en prod**
Dos módulos nuevos (`pages/legal/`, `pages/documentos/`), ninguno existía antes de esta ronda. Verificado en vivo (`npm start` + Chromium headless, usuario dev `QA abogado`): Home (tiles Legal/Documentos), Legal (hub, Expedientes lista+KPIs+vacío+crear, Contratos lista+vacío+crear con los 3 caminos), Documentos (hub, Generar con las 8 plantillas reales de sgc-dev, Historial, Plantillas) — todo con datos reales, sin errores de consola nuevos.
- **Contrato consumido (confirmado vía extracción exhaustiva del `sql/` del padre):** NO hay RPC de listado/detalle/creación para `expedientes_legales` ni `contratos` (solo `contrato_detalle(p_id)` y `documento_usado_en_contrato(p_documento_id)` son RPC reales) — todo lo demás es acceso DIRECTO a tabla bajo `is_admin() or tiene_modulo('legal')`. `documentos_generados` tampoco tiene RPC de creación/listado — insert/select directo (RLS más compleja: `generado_por=auth.uid()` o módulo `documentos`/`proyectos` o aprobación legal). `plantillas_documento.campos` confirmado como `{key,label,tipo}` — **sin** campo `ejemplo` (la "vista previa con datos de ejemplo" usa `[Label]` como placeholder, no datos reales de muestra).
- **Decisión de arquitectura de PDF, tomada:** `core/utils/documento-pdf.util.ts` — parser de bloques HTML (h1-h3/p/li/tabla/hr) + jsPDF con texto posicionado a mano, el MISMO patrón ya usado en este repo (`orden-trabajo-pdf.service.ts`, `carnet-pdf.util.ts`, `export.service.ts`). Se descartó deliberadamente `jsPDF.html()`/html2canvas (ningún otro PDF de la app lo usa — más frágil en WebViews de gama baja). Limitación conocida: negrita/cursiva en línea se aplana a texto plano.
- **Bucket `contratos-firmados` mencionado en el comentario de la migración CO13 no existe como bucket propio** — la app sube el PDF firmado a una carpeta `contratos-firmados/<id>/…` DENTRO del bucket `sgc-legal` ya existente (mismo gate RLS), para no depender de un bucket no confirmado en `sql/`.
- **3 bugs reales encontrados y corregidos durante la verificación en vivo:**
  1. Los 5 overlays nuevos (expedientes/contratos/historial/plantillas/compras-tec) usaban `z-index: 420`, por DEBAJO de `notif-health-band` (499) — tapaba el botón atrás cuando la cinta estaba visible. Corregido a `900`.
  2. `legal.service.ts` insertaba directo a las 4 tablas (expedientes/notas/archivos/contratos) **sin autor** (`creado_por`/`usuario_id`/`subido_por` NULL — sin RPC ni default `auth.uid()` server-side). Corregido con helper `miUid()`; verificado contra sgc-dev.
  3. `subirFirmado()` (PDF firmado de un contrato, `upsert:true`) fallaba 400 silencioso: al bucket `sgc-legal` le faltaba la política UPDATE en `storage.objects`. Documentado en `sql-para-sgc/2026-10-15-co19-sgc-legal-update-policy.sql`; **el padre ya lo aplicó en dev+prod** (su propio guard `audit-buckets-upsert-policy.mjs`, commit SGC `742c271`) — cerrado.
- **Hueco real abierto (no es bug, es una pregunta de producto):** la RLS de `expedientes_legales`/`contratos` NO scopea por `proyecto_id` — cualquier usuario con el módulo `legal` ve TODOS los expedientes/contratos de TODAS las obras. **Pendiente confirmar con Xaviel/Sonia** si es la regla deseada o si debería acotarse (RLS del padre, no es cosa de la app).
- **Verificado en una corrida anterior, no repetido tras los fixes** (el fix de autor no toca este camino): Documentos › Generar → vista previa → guardar → compartir por WhatsApp de punta a punta. Debería seguir funcionando igual.

### CO6 — Compa ahora muestra enlaces y PDF (cerrado, **en prod**)
La burbuja de Compa era `{{ m.texto }}` plano — ningún enlace markdown/suelto se veía clicable y no había forma de abrir un PDF generado (`generar_reporte_pdf`). Se reutilizaron 2 componentes ya existentes sin tocarlos: `app-markdown-view` (mensajes del asistente, GFM + autolinks + DOMPurify) y `app-pdf-viewer` (visor inline pdf.js, ya usado en `mensajes/thread`). Nuevo: detección de URL `.pdf` en el texto (`CompaPage.pdfDe()`) → botón "Ver PDF" que abre el mismo visor. Los mensajes del usuario siguen en texto plano (no lo necesitan).

## CP (ronda 16/10/2026, `feature/cp-ronda`) — app 2.54.0, backend/web ya en prod

> Todo el backend/web de PROMPT-100 (CP1-CP11) ya está **en prod** (SGC HANDOFF.md,
> web 1.191.0) antes de empezar esta ronda — esta sección documenta solo el lado
> app. Build + `test:canal` verdes en cada fase; commiteado y mergeado a `dev` con
> OK explícito de Xaviel. Nota de numeración (dos saltos, no uno): esta ronda iba a
> ser 2.52.0 por prompt, pero una sesión concurrente ya shippeó el import masivo de
> choferes/vehículos (CSD-importar, no-CP) como 2.52.0 → esta ronda pasó a 2.53.0;
> mientras esta sesión trabajaba, OTRA sesión concurrente le aplicó un fix al import
> (fotos por cédula/placa) y bumpeó a **2.54.0** (2.53.0 ya estaba tomada) — el
> release final es 2.54.0 e incluye ambas cosas.

- **CP6 (Por despachar):** `requisiciones_por_despachar()` ya traía `codigo`/
  `urgencia`/`fecha_necesidad` (padre, aditivo) — la tarjeta del app no los pintaba.
  Ahora: código + fecha relativa (`formatFechaDespacho`, nuevo en `core/util/fecha.ts`)
  + grupo "Esperando hace más de 2 días" arriba. Barrido confirmado: bandeja, mis
  requisiciones y conduces **ya mostraban fecha** (BV10/AK7/AK22) — sin cambios ahí.
- **CP5 (release-check):** `scripts/release-check.mjs` gemelo del padre, pero sin
  ledger de migraciones ni evals de Compa (eso lo audita el padre sobre sus propios
  archivos) — 4 checks propios: dev respiró/OK, `qa/release-<v>.md` con "Versión de
  origen" (fuerza documentar la prueba de actualización in-app, CL4), los 3 sitios
  de versión alineados, build+test:canal. **Gatea `apk:publish --env prod`**
  (llamada automática desde `release-apk.mjs`, igual que la regla 18). Cinta de
  entorno ahora dice "Staging (dev)" (antes "DEV"), espejo del padre.
- **CP3 (Compa archivos[]):** el edge ya manda `archivos[]` (+ `archivo` de
  compat) — el app solo leía `archivo` vía regex de texto. Ahora `CompaRespuesta`/
  `CompaMensaje` traen `archivos: {nombre,url}[]`; cada uno abre `app-pdf-viewer` si
  es PDF o `window.open` si no. El detector de texto plano se conserva como fallback.
- **CP2 (Compa compartir):** nuevo `compa_compartir`/`compa_compartidas_conmigo`/
  `compa_conversacion_compartida` cableados. Botón 📨/📤 en el header de Compa,
  banner fijo ("Tecnología puede revisar…"), hoja "Compartir" (picker `buscar_usuarios`,
  mensaje opcional), pantallas nuevas `compa/compartidas` (lista) y
  `compa/compartida-detalle` (solo lectura — el RPC no devuelve `propuesta`, así que
  no hay nada que confirmar ahí) + "Seguir en una conversación mía" (precarga el
  composer vía el `?q=` que ya existía, sin RPC nuevo). **Gotcha real:** la
  notificación `compa_compartida` manda el `conversacion_id` en la ruta, NO el id
  del share (`notificar_usuarios` no lo conoce) — la lista "Compartidas conmigo"
  resuelve cuál share es filtrando por `conversacion_id` antes de abrir el detalle.
- **CP1 (Personal de obra):** `listar_personal_obra` ya traía `tiene_contrato`/
  `tiene_foto_persona` (desde `sql/2026-10-01-ce1-listar-personal-extra.sql`) pero
  el modelo TS no los declaraba — "Le falta" solo mostraba carnet/seguro. Ahora 4
  categorías (+contrato/+foto), franja "Expedientes completos N de M", chips "Le
  falta" por fila (o "✓ Completo"), pie "Mostrando N · M de prueba ocultos". No se
  tocó el fallback de select directo a tabla (esos 2 campos no son columnas reales,
  solo existen vía el RPC — si cae al fallback, undefined se trata como "falta").
- **CP8 (Reuniones, módulo nuevo):** `pages/reuniones/*` (lista con 4 pestañas,
  ficha, crear corto) + `core/services/reuniones.service.ts`. Ficha: unirse
  (`abrirUrlExterna`, ya existente), agenda, Mis notas (texto + Dictar vía
  `CompaService.transcribir`/`app-voice-recorder`, ya existentes) + Mis acuerdos
  (`reunion_acuerdos_pendientes_mios`, cruza TODAS mis reuniones, no solo esta) +
  recordatorio local 15 min antes (`@capacitor/local-notifications`, id = hash
  estable del uuid; el tap ya deep-linkea solo por el listener genérico existente
  en `push.service.ts` — se agregó `/reuniones` al allowlist de `notifAppRoute`).
  **Hueco real encontrado y cerrado con SQL propio:** `reunion_notas` no tenía
  columna para "Foto de pizarra" (el mock la pide) — `sql-para-sgc/2026-10-16-
  cp8c-reunion-notas-foto.sql` (aditivo: columna `foto_path`, bucket `reuniones`,
  `reunion_nota_guardar`/`reunion_detalle` con el 4º parámetro/campo opcional).
  Capability-safe: si el padre aún no lo aplica, el intento de guardar la foto
  falla y el outbox reintenta solo cuando esté — la nota de TEXTO se guarda igual
  (el RPC viejo sin `p_foto_path` también sigue funcionando por compatibilidad).

## CQ (ronda 17/10/2026) — decisiones de paridad app↔web
Backend (SGC) ya vivo en sgc-dev para toda la ronda (verificado por RPC probe antes de
empezar) — `cp8c` también confirmado aplicado (`reunion_notas.foto_path` existe).
- **CQ4 (Importar):** plantilla de vehículos/choferes ampliada a todos los campos reales
  de `vehiculo-form.ts`/`conductor-form.ts` (VIN, kilometraje, seguro, matrícula,
  mantenimiento, capacidad, alias, vehículo asignado, tags, activo). Revisión antes de
  importar (miniaturas por fila vía `URL.createObjectURL`, fotos sin dueño asignables a
  mano), detección de "no es la plantilla del SGC" (tasa de coincidencia de headers),
  resultado en modal con fondo oscurecido/borroso + qué cambió por registro.
  **Candado CQ4-g implementado** (`scripts/verify-import-template-paridad.mjs`, en
  `prebuild`): compara los signals de dato real de ambos formularios contra
  `ENTIDADES_IMPORTACION` — con un hueco real y aceptado: `conductor-form.ts` tiene
  `esPrueba` pero `importar_conductores` (a diferencia de `importar_vehiculos`) NO lee
  `v_fila->>'es_prueba'` en el RPC, ni en el INSERT ni en el UPDATE — agregar la columna
  a la plantilla sin que el RPC la use engañaría al usuario. **Debe el padre:** espejar en
  `importar_conductores` el mismo `case when v_fila ? 'es_prueba'...` que ya tiene
  `importar_vehiculos`. **También simplificado:** choferes solo suben la foto de cédula
  (`foto_path`); `licencia-frente`/`licencia-dorso` se detectan y etiquetan en la revisión
  pero NO se suben — `sgc.conductores` no tiene columnas `licencia_frente_path`/
  `licencia_dorso_path` (confirmado por lectura directa en sgc-dev).
- **CQ2 (Dev notes):** editor nuevo en la app (`tecnologia/dev-notes/editor/`,
  pantalla completa, toolbar fija bold/italic/H3/listas en vez del menú "/" del mock,
  autoguardado 2s, "Texto simple" ⇄ con formato, "Mandar a ronda" a texto plano, agrupado
  Hoy/Esta semana/Antes). Sin hueco de backend: `guardar_nota` ya soporta
  `p_ambito/p_formato/p_tags` desde `sql/2026-09-14-bp5-notas-ambito-dev.sql` y
  `nota_marcar_enviada_ronda` desde `sql/2026-10-16-cq2-dev-notes-enviada.sql` — ambos
  confirmados ya en prod.
- **CQ3 (Auditoría):** nueva pestaña "Actividad" (por defecto) consumiendo
  `auditoria_actividad`/`auditoria_historia_registro` (línea de tiempo en español,
  cursor-paginada, búsqueda+filtros, detalle con Campo·Antes·Después). Panel/Filas se
  quedan intactos. **"Acciones de admin" NO existe en la app** (nunca se construyó esa
  pantalla aquí) — el fix del bug `audit_log_listado` (`::text`) es 100% web/servidor, sin
  acción del lado de la app.
- **CQ1 (Compras tecnológicas):** la app SOLO actualizó la ficha de ver/aprobar (crear con
  cotización sigue siendo trabajo de la web, decisión ya tomada). Nuevos campos del
  servidor (`titulo`/`urgencia`/`subtotal`/`itbis`/`total`/`unidad` por renglón/
  `fecha`+`lectura`+`lectura_costo_usd` por cotización) ya cableados; aviso si el total no
  cuadra con la cotización elegida (±1%); todas las cotizaciones listadas, no solo la
  elegida.
- **CQ6 (sesiones concurrentes):** esta ronda se trabajó en `feature/cq-ronda` vía
  `git worktree add ../csd-app-cq` (worktree dedicado, node_modules enlazado por junction
  — no reinstalado). Los 4 módulos (importar/dev-notes/auditoría/compras-tec) se
  repartieron entre 4 agentes en paralelo sobre archivos disjuntos dentro del MISMO
  worktree — sin colisiones (confirmado por `git diff --stat` antes y después).
- **CQ7 (prueba de teléfono):** `qa/release-2.55.0.md` dejado a propósito en rojo
  (sin línea "OK:") — `release-check.mjs --version 2.55.0` da 🔴 en el check "breathe"
  hasta que Xaviel haga la prueba real en el Samsung o dé su OK explícito. NO se publicó
  nada a prod en esta sesión.
