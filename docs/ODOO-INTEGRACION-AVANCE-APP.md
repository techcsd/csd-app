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

## Pruebas
`npm run build` ✔ (guardas i18n en 100 % es/en/ht). Prueba contra backend dev y en teléfono = paso físico de Xaviel.
