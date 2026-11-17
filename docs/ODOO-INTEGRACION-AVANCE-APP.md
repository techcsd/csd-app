# Integración Odoo — avance del lado app (ronda DS, PROMPT 149)

Reanudable. Rama `feature/ds-ronda-16nov-app` (worktree `csd-app-ds`), versión **2.71.0**, PR a `dev`.
La app **nunca habla con Odoo**: todo pasa por RPC/edges de SGC. Contratos consumidos verificados en `origin/dev` de SGC (`sql/2026-11-16-ds*.sql`, edge `conduce-qr`).

| ID | Qué | Estado | Dónde |
|---|---|---|---|
| DS-48 / F1 | Recepción envía `p_items` siempre (recibida = enviada, ajustable) | **Hecho** | `por-confirmar.ts` (`confirmar`), `entrega.ts` |
| DS-49 / F2 | Ruta `/conduce-qr/:token` → edge `conduce-qr` (`resolver`) → abre la recepción de esa salida | **Hecho (ruta)** · escáner/enlaces nativos pendientes | `pages/conduce-qr`, `ConducesService.resolverQrConduce`, `por-confirmar` (`?abrir=`) |
| DS-50 / F3.1 | Chip «Registrado en el sistema contable / Pendiente de registrar / Hay que revisar» (solo roles de gestión) | **Hecho** (lectura best-effort de `odoo_sync_estado`) | `conduce-detalle` |
| DS-50 / F3.1 | Parada `entregada` con hora real, sin doble cierre | **Ya existía** (`entGuardando` CO16 + `entregada_at` al instante) | `conduces.ts:319` |
| DS-24 / F3.2 | Motivo de rechazo obligatorio (≥10, igual que `rechazar_solicitud_material`) | **Hecho** | `solicitudes/detalle` |
| DS-52 / F3.3 | Notificación → detalle de la requisición ya existía (`notifAppRoute`); ahora el enlace sobrevive a login/PIN y `appUrlOpen` navega | **Hecho** | `DeepLinkService`, guards, `app.ts` |
| F3.4 | Selectores solo con artículos aprobados | **No hecho** — SGC no expone aún filtro de homologación en las RPC que usa la app; no se filtra en cliente (instrucción) | — |
| DS-51 / F4.1 | Asistente de GPS + motivo de rechazo + inicio automático por parámetro | **No hecho** — no hay RPC/parámetro de SGC (`gps_*`/viaje automático) en `origin/dev`; ya existe el gate `exigirGps` (AF26) con «Abrir ajustes» | `tracking.service.ts:232` |
| DS-51 / F4.2 | Arranque estable | **Parcial** — la app NO pide zonas horarias (0 coincidencias de `pg_timezone_names`/zonas). Falta consumir `mi_arranque()` (DS-45b, ya en SGC dev) e instrumentar tiempos | — |

## Pendiente para retomar
1. `mi_arranque()` en el arranque (reemplaza `mis_preferencias` ×3 + conteos) con timeout explícito y caída a lo último guardado.
2. Asistente GPS (cuando SGC defina el parámetro de inicio automático y dónde guardar el motivo del rechazo).
3. Escáner de QR dentro de la app (plugin ML Kit → nuevo permiso/dato: actualizar `docs/TIENDAS-DATOS.md`, CI13) y App Links (`assetlinks.json` en el dominio) para que el QR de la web abra la app nativa; hoy el QR codifica el origen de la web SGC.
4. Selectores de artículo aprobados cuando SGC lo exponga.

## Pruebas en teléfono real (17-nov, APK dev 2.71.0, SM-A205U Android 10, backend dev)
- **QR → recepción: OK.** Token emitido por la edge `conduce-qr` → enlace con esquema propio (`<scheme>://conduce-qr/<token>`, intent-filter nuevo) → app bloqueada → PIN → retomó el enlace → abrió la recepción de esa salida. Con la app ya abierta, `appUrlOpen` navega directo (también a `conduce-detalle`).
- **DS-48 OK:** «Sí, todo» (4+10 uds) → `estado=entregado`, `cantidad_recibida` 4 y 10 (antes NULL). «Faltó algo» sin bajar cantidad → bloqueado con aviso; con 6/10 → `entregado_incompleto`, 6.
- **DS-24 / chip contable: NO probados en vivo.** Reject: el QA no tiene el módulo de compras (la pantalla responde «No tienes acceso», que es el gate correcto). Chip: la lectura directa de `salidas_inventario` devuelve vacío por RLS para el QA → **pedido a SGC** (abajo).

## Pedido a SGC
1. **Exponer `odoo_sync_estado` en `conduce_detalle_app`** (o RPC `conduce_estado_sync(p_salida_id)`, solo roles de gestión). La app ya lo lee de ahí si viene; si no, cae a un select directo que la RLS bloquea.
2. **`conduce-qr` `emitir`** devuelve `sin_acceso` a un confirmador designado (`firma_pendiente_usuario_id`) que no ve la salida por RLS: validar con `es_confirmador_de_conduce()` además de la RLS.
3. QR de la web: hoy codifica el origen de la web SGC; para abrir la app nativa hace falta App Links (assetlinks) o que el QR use el esquema de la app.
