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
