# PARIDAD-DF.md — Ronda DF (PROMPT 128 web / PROMPT 129 app)

> Qué existe en la web (SGC, repo `SGC-df`, rama `feature/df-ia-agentes-animaciones`,
> backend ya desplegado al Supabase de dev) vs qué existe en esta app (csd-app, mismo
> worktree/rama, también sin mergear). Regla 5 (CLAUDE.md): "si una feature de la app
> implica una vista web, construirla también en la web" — esta tabla es la contraparte:
> qué de la web NO tiene (ni necesita) equivalente en la app.

## F1 — Modo rápido / lectores IA (DF1)

| Pieza | Web (SGC) | App (csd-app) |
|---|---|---|
| Bitácora modo rápido (fotos+voz → parte) | `bitacora/nueva` | `bitacora/parte` — **completo**, paridad total (misma edge `bitacora-ia`) |
| Conduce externo por foto | `conduce-externo-form` | `transporte/conduce-externo` — **completo** |
| Mantenimiento por voz | `mantenimientos.ts` (drawer) | `transporte/mantenimiento` (wizard de 4 pasos, paso 2) — **completo**, pero la app NO aplica el `vehiculo_sugerido` (en la app el vehículo ya viene fijo por ruta antes de abrir la pantalla; en la web sí hay un selector de vehículo en el drawer) |
| Checklist de vehículo por voz | `flota/checklists` | `transporte/preuso` — **completo** |
| Requisición por voz | `bitacora/solicitudes-material` | `solicitudes/pedir` — **completo** |
| Gastos/facturas (factura_general) | Backend listo (`leer-recibo` extendido), **sin pantalla en ningún lado** | Sin pantalla (no existe "Gastos" ni en la web ni en la app) |
| Rutas (tipo='ruta') | Backend declarado pero devuelve 501 (no implementado) | No consumido (nada que consumir) |

## F2/F3 — Agentes de monitoreo (DF2/DF3)

| Pieza | Web (SGC) | App (csd-app) |
|---|---|---|
| Oficina isométrica completa (6 estaciones, SVG propio) | `/tecnologia/agentes` — **completo** (aunque el propio SGC reporta que visualmente quedó como tarjetas planas, no la escena isométrica del mockup — pendiente de pasada de diseño) | **No existe — a propósito.** El prompt (F3.5) pide una MINIATURA de solo lectura, no la oficina completa |
| Miniatura/lista de los 6 agentes | — (la web tiene la oficina completa, no una miniatura aparte) | `/tecnologia/agentes` — **completo**: lista compacta con punto+estado, última acción, gate `esTecnologia()` |
| Esperan tu OK (aprobaciones) | Panel completo en la oficina | **Completo** en la app — mismas 3 acciones (Aprobar para dev / Pedir ajuste / Descartar), misma RPC `decidir_agente_aprobacion` |
| Lo que arreglaron solos + Deshacer | Panel completo | **Completo** en la app, misma RPC `deshacer_agente_accion` |
| Informe diario (Cronista) | Se arma, se ve, y el envío a jefes es un clic en la web | **Completo pero solo lectura** — la app muestra el informe (`<app-markdown-view>`) pero el envío a jefes se hace desde la web (tal como pide el prompt F3.3) |
| Agente Escriba (Nivel 3, PR automático) | Infraestructura completa, bloqueada en secretos de GitHub/Supabase que Xaviel ya configuró — pendiente la primera prueba real | **No aplica a la app** — el Escriba propone código al repo del SGC, no tiene superficie en csd-app más allá de aparecer en la lista de agentes |

## F4 — Animaciones (DF4)

| Pieza | Web (SGC) | App (csd-app) |
|---|---|---|
| Camión con rotación por rumbo | `flota/seguimiento` (tablero multi-vehículo), `shared/utils/geo.util.ts` (web) | `transporte/seguimiento` — **completo**, `shared/utils/geo.util.ts` (app, implementación propia — no es el mismo archivo que el de la web, geometría pura equivalente) |
| ETA ("Llega en N min") | **Completo** — `sgc.tablero_vivo_resumen()` extendido con `destino_lat/lng` + velocidad derivada de `km_estimado`/`tiempo_estimado_min` de `sgc.rutas` | **No implementado** — `rutas_activas_y_hoy` (la RPC que alimenta la pantalla de la app) solo expone el destino como texto, no coordenadas. Requiere una extensión de backend que esta ronda no incluyó (ver HANDOFF, sección F4) |
| Línea de vida del conduce | En la ficha del conduce externo, 2-3 nodos reales (igual limitación: `conduces_externos` solo tiene emitido/recibido/anulado) | **Completo**, mismo criterio exacto (nunca se inventaron los 5 nodos del mockup original) |
| Pulso de obras | Dashboard web, anillo que respira naranja→verde, `sgc.pulso_obras_hoy()` | **Completo** en el home de la app, mismo RPC. La app usa un pulso discreto (`appEstadoPulse`) en vez de una respiración continua — ver decisión en HANDOFF |
| Requisición → recepción (flujo con cuello de botella) | Dashboard web — vista AGREGADA (tiempos promedio entre MUCHAS requisiciones + cuál etapa es más lenta), `sgc.requisicion_flujo_tiempos`/`requisicion_flujo_detalle` | **Distinto a propósito**: la app muestra el estado de LA PROPIA requisición del usuario (Solicitada→Aprobada→Despachada→Recibida), no la analítica agregada — son dos vistas complementarias, no la misma feature duplicada |
| Pulso del sistema (BD/crons/cola/STT/uso_ia/GPS) | `admin/pulso-sistema` — **completo** | **No aplica** — es una pantalla de administración de infraestructura, sin superficie de usuario de campo en la app |
| ETA en tablero multi-vehículo | `tablero-vivo` component — **completo** | La app no tiene un tablero multi-vehículo equivalente (tiene `seguimiento` de flota, que es distinto) |

## Resumen para Xaviel

- **Paridad real (mismo dato, misma UX, dos implementaciones)**: los 5 lectores IA (bitácora + 4 formularios), los 3 paneles de agentes (aprobaciones/acciones/hallazgos), línea de vida del conduce, pulso de obras.
- **Solo web (a propósito, por diseño del prompt)**: la oficina isométrica completa, el agente Escriba como flujo de PR, el pulso del sistema (admin de infraestructura).
- **Solo web (por falta de backend, no por diseño)**: ETA en minutos para un solo vehículo — la web lo tiene porque `tablero_vivo_resumen()` ya expone coordenadas de destino; la RPC que usa la app (`rutas_activas_y_hoy`) no las expone todavía.
- **Solo app (complementa, no duplica)**: vista de "mi propia requisición" etapa por etapa — la web solo tiene la vista agregada de cuellos de botella.
