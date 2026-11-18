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
| DS-51 / F4.1 | Asistente de GPS (permiso vs ubicación apagada, abrir ajustes, reintento) + motivo si lo rechaza (`registrar_gps_evento` tipo `operando_sin_gps`, detalle `asistente_rechazado:<clave>:<motivo>`, sin cambios en SGC) | **Hecho en código, sin probar en el teléfono** (alcanzarlo exige completar el asistente de 8 pasos de «Crear conduce») · inicio de viaje automático **no hecho** (SGC no tiene el parámetro) | `GpsAsistente`, `GpsAsistenteService`, `TrackingService.exigirGps` |
| DS-51 / F4.2 | Arranque estable | **Hecho (lecturas)**: `ArranqueService` = una sola llamada `mi_arranque()` (fallback `mis_preferencias`) compartida por idioma/bienvenida/Compa/avisos, timeout 8 s, 1 reintento solo en lectura, tiempos en memoria. La app no pide zonas horarias. Sin probar con medición real (falta ver los tiempos en uso) | `ArranqueService` |

## Pendiente para retomar
1. Medir `ArranqueService.tiempos` en un teléfono real y, si hace falta, caída a lo último guardado en disco.
2. Probar el asistente de GPS en el teléfono; inicio de viaje automático cuando SGC cree el parámetro.
3. Escáner de QR dentro de la app (plugin ML Kit → nuevo permiso/dato: actualizar `docs/TIENDAS-DATOS.md`, CI13) y App Links (`assetlinks.json` en el dominio) para que el QR de la web abra la app nativa; hoy el QR codifica el origen de la web SGC.
4. Selectores de artículo aprobados cuando SGC lo exponga.

## Pruebas en teléfono real (17-nov, APK dev 2.71.0, SM-A205U Android 10, backend dev)
- **QR → recepción: OK.** Token emitido por la edge `conduce-qr` → enlace con esquema propio (`<scheme>://conduce-qr/<token>`, intent-filter nuevo) → app bloqueada → PIN → retomó el enlace → abrió la recepción de esa salida. Con la app ya abierta, `appUrlOpen` navega directo (también a `conduce-detalle`).
- **DS-48 OK:** «Sí, todo» (4+10 uds) → `estado=entregado`, `cantidad_recibida` 4 y 10 (antes NULL). «Faltó algo» sin bajar cantidad → bloqueado con aviso; con 6/10 → `entregado_incompleto`, 6.
- **Chip contable OK (17-nov, 2ª tanda):** con `conduce_estado_sync` (SGC `dt`) el detalle del conduce muestra «Pendiente de registrar» en el teléfono, como QA flota elevado. **DS-24 (motivo de rechazo) sigue sin probarse en vivo**: el QA no tiene el módulo de compras («No tienes acceso», gate correcto).

## Pedido a SGC
1. ~~**Exponer `odoo_sync_estado` en `conduce_detalle_app`**~~ **Resuelto** con el RPC `conduce_estado_sync` (SGC `dt`, ya en prod):  (o RPC `conduce_estado_sync(p_salida_id)`, solo roles de gestión). La app ya lo lee de ahí si viene; si no, cae a un select directo que la RLS bloquea.
2. **`conduce-qr` `emitir`** devuelve `sin_acceso` a un confirmador designado (`firma_pendiente_usuario_id`) que no ve la salida por RLS: validar con `es_confirmador_de_conduce()` además de la RLS.
3. QR de la web: hoy codifica el origen de la web SGC; para abrir la app nativa hace falta App Links (assetlinks) o que el QR use el esquema de la app.

## Asistente de GPS — prueba en teléfono (17-nov, noche)
- **Probado:** el asistente abre al «Generar conduce» sin fix; las instrucciones se pueden seguir (se encendió «Ubicación» desde la barra); «Ya lo activé» comprueba y, con la ubicación encendida pero sin señal (bajo techo, proveedor de red desactivado), muestra el mensaje nuevo «sin señal» (PR #43).
- **Probado el 18-nov:** «Ahora no» → «No sé cómo hacerlo» cierra el asistente sin crear el conduce y registra `operando_sin_gps` con `detalle = asistente_rechazado:no_se_como:apagado` en `gps_eventos` (dev).
- **No probado:** el camino feliz (gate abre y el conduce se crea) — sigue sin haber fix GPS en el lugar de prueba (18-nov, otra vez bajo techo; Android 10 no permite ubicaciones simuladas por adb). Pendiente: repetir con el teléfono cerca de una ventana o al aire libre.
- Nota de UX: con el GPS sin fix la comprobación tarda ~30 s (5 s rápida + 12 s precisa + reintentos) antes de avisar.
