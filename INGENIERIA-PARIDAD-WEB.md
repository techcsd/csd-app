# AT6 — Inventario del módulo "Ingeniería" de la app (para replicar en la web SGC)

Regla madre: **todo lo que está en la app debe existir en la web**. Este es el inventario del módulo **Ingeniería** tal como vive HOY en la app móvil (csd-app), para que la web lo replique. El backend YA existe (PROMPT-29/AY11, todo en prod); la web solo debe construir la UI y colgar el ítem en su sidebar con icono y módulo correctos.

## 1. El módulo
- **Clave de módulo:** `ingenieria` (en `sgc.roles.modulos`). Ya asignado (migración `2026-08-23-ay11-modulo-ingenieria.sql`) a: `ingeniero_campo`, `ingeniero_oficina`, `jefe_ingenieros`, `gerente_produccion`, `gerente_proyectos` (operativos) + referentes que lo VEN: `direccion`, `gerencia`, `jefe_flota`, `logistica`, `coord_compras`, `guarda_almacen`, `admin`.
- **Gate app:** tile en el home `hasModulo('ingenieria')`; ruta `/ingenieria` con `moduleGuard('ingenieria')`.
- **Hub:** `pages/ingenieria` — por ahora concentra 1 submódulo (extensible). Icono del módulo: 📐.

## 2. Submódulo: "Solicitud de movimiento"
Es el ÚNICO submódulo hoy. **Importante (AT6):** en la web actual "Solicitud de movimiento" aparece **suelta, sin icono y sin módulo padre** (colgando de Legal/Bitácora según el sidebar). Debe **moverse dentro del módulo Ingeniería** y darle icono (🚚).

### Qué hace
Un ingeniero pide al depto. de transporte que **mueva material/equipo** (llevar a la obra / sacar de la obra). Un **referente** (logística/jefe de flota/…) lo **planifica** creando la ruta, que queda vinculada a la solicitud.

### Dos vistas
1. **Crear solicitud** (ingeniero) — ruta app `/transporte/crear-solicitud-movimiento`:
   - Campos: **Dirección** (Llevar a la obra / Sacar de la obra) → define origen/destino; **obra**; **tipo de carga** (`materiales` | `equipo` | `otros`); prioridad; fecha de requerimiento; notas.
   - **Offline por outbox** (`solicitud_movimiento_crear`).
   - ⚠️ Constraint del backend (ya cazado): `origen_tipo/destino_tipo ∈ (almacen,obra,proveedor,otro)` y `tipo_carga ∈ (materiales,equipo,otros)`. La obra es origen o destino según la Dirección.
2. **Bandeja** (`/transporte/solicitudes-movimiento`):
   - El **ingeniero** ve las suyas (RLS).
   - El **referente** (`es_referente_movimiento`) ve TODAS con filtros (estado/prioridad), y puede: **Planificar** (elige vehículo+chofer+fecha → crea la ruta pre-llenada y la vincula), **Completar**, **Cancelar**.
   - Prioridad con escala de color (no todo rojo) + semáforo de urgencia por `dias_para_requerimiento`.

### RPCs backend (todas en prod)
- `solicitud_movimiento_crear(...)` (o el handler de outbox equivalente) — crear.
- `solicitud_movimiento_detalle(id)` — para pre-llenar la planificación.
- `es_referente_movimiento()` — gate del rol que planifica.
- `..._pendientes_count` — badge.
- `planificar_solicitud_con_ruta(...)` — planificar creando la ruta.
- `vincular_solicitud_ruta(p_solicitud_id, p_ruta_id)` — marca la solicitud como planificada + copia el chofer (referente-only).
- Estados: pendiente → planificada → completada / cancelada.

### Planificar = redirigir al wizard de crear-ruta pre-llenado
En la app, "Planificar" navega a `/transporte/rutas/crear` con queryParams (`solicitud`, `destinoLugarId`/`origenLugarId`, textos, notas); crear-ruta pre-llena origen/destino, fuerza modo asignador (elige chofer) y pasa `solicitud_id` a `crear_ruta`; el handler llama `vincular_solicitud_ruta` tras crear. La web puede hacer lo mismo o un modal de planificación directo.

## 3. Checklist de paridad para la web
- [ ] Crear el módulo **Ingeniería** en el sidebar web (icono 📐), gated por `roles.modulos` conteniendo `ingenieria` (misma fuente de verdad que la app).
- [ ] Mover **"Solicitud de movimiento"** DENTRO de Ingeniería, con icono 🚚 (hoy está suelta sin icono ni módulo).
- [ ] Vista **Crear solicitud** (ingeniero) con Dirección/obra/tipo_carga/prioridad/fecha/notas.
- [ ] Vista **Bandeja**: ingeniero (las suyas) vs referente (todas + filtros + Planificar/Completar/Cancelar).
- [ ] Consumir las mismas RPCs (no crear nuevas): `es_referente_movimiento`, `planificar_solicitud_con_ruta`, `vincular_solicitud_ruta`, detalle/listar/count.
- [ ] Revisar que NINGÚN ítem del sidebar web quede sin icono ni módulo padre (el bug de AT6 era transversal).

## 4. Nota de auditoría de paridad (recurrente)
Este es el hallazgo recurrente de AL2 (Tecnología/Administración) repetido: conviene una **tabla de módulos/submódulos × (web, app) + gating** mantenida en el tiempo. Lo NUEVO que la app tiene y la web (a confirmar) puede que no: el **módulo Ingeniería** completo + **"Solicitud de movimiento"** dentro de él.
