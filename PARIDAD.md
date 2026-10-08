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
