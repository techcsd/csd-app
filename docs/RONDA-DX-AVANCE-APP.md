# RONDA DX — avance app (PROMPT-155, 23-nov-2026)

Worktree: `../csd-app-dx` · rama `feature/dx-ronda-23nov-app` desde `origin/dev` (940542e, 2.71.12). Nada commiteado aún (pendiente aviso a Xaviel).

## F0 — informe (confirmado vs supuesto)
- **Repos:** `origin/main` = 2.71.11 (479df7d), `origin/dev` = 2.71.12 (940542e); dev va 3 PR por delante de main (aviso duplicado 2.71.12 + docs). Prod congelado en 2.71.11 (HANDOFF). Grafo reconstruido en el worktree (940542ec).
- **Reportes (conector SGC, 23-nov):** SGC (PROMPT-154, v1.221.0) ya respondió/cerró CANCELAR, CAMBIO DE PRODUCTO, NO PUEDO ACCEDER, Vigía crash y la sugerencia de Yonairy. **Abiertos/en curso que tocan la app:** «BOTON DE CONFIRMAR CONDUCE» (Raykler, en_progreso → F4 escáner), «error al reconectarse a odoo» (**confirmado: NO es de la app ni de SGC; es el conector de Odoo de Claude Desktop** — la respuesta ya está en el reporte), «Vigía: gps timeout» (abierto), «No sale combustible» (Corianny, web/página; sin foto vista).
- **Fotos de los reportes:** NO abiertas (no hay URL firmada sin service key de prod; no se usó). Lo que dependía de ellas se resolvió por texto + respuestas ya publicadas.
- **Confirmado en código:** rechazo de requisición ya exigía ≥10 car. (`detalle.ts`) pero deshabilitaba el botón **sin decir por qué**. `conduce-detalle` llamaba `eliminarConduce(id)` **sin motivo** → desde dj7 (6-nov) `anular_conduce` lo rechaza (22023) y, al ir por outbox, el usuario veía «eliminado» y la op quedaba atascada: **bug real**. Por aprobar (combustible) ya muestra recibo/tablero/bomba con «No se pudo cargar la foto + Reintentar». `reemplazarArticuloRenglon` existe y se llama con el `a.id` elegido (sin hallazgo de «sale otro»; falta prueba con Plywood en dev).
- **No hecho en F0:** adb no está en el PATH de la sesión (estado A20/`version_publicada` no consultado); repro con usuario de rol Raykler en dev no ejecutado.

## Hecho (sin commit)
- **F1:** `core/util/motivo.ts` (+spec); contador «n/10 · faltan x» en rechazar requisición; motivo obligatorio con contador en Eliminar conduce (hoja en vez de confirm). i18n en/ht.
- **F3 (correo):** `core/util/notificar-resultado.ts` (+spec) lee `{data,error}`/`skipped`; fallo → op `solicitud_correo` reintentada por el outbox (backoff; visible si se atasca). **Desviación:** reintenta con backoff hasta ceder, no «una sola vez».
- **F2 (GPS):** timeout adaptativo ya existía (DM-25). Ahora «sin señal» y «GPS apagado en el teléfono» se registran como `info` con `causa` (Vigía no abre bug por cada chequeo bajo techo); `registrar_posiciones rechazó el lote` lleva `causa` = sesion | rls_permiso | carga_invalida | transitorio.
- Build verde (`npm run build`), `ng test` 97/97.

## Pendiente (siguiente sesión)
F3 adjuntos de reportes en Administración + mensajes Odoo/chip `conduce_estado_sync` · F4 escáner QR (plugin Capacitor + BarcodeDetector, deep link `/d/:token`, QR en requisición/OC/entrada/retiro; depende de la edge `doc-qr` de PROMPT-154 F7) · F5–F8 tiendas (AAB, permisos, TIENDAS-DATOS vs 2.71.x, CI iOS, checklist diciembre) · F7 fuente de instalación/Play in-app updates · F9 verificación Odoo/Compa · F10 cierre (graphify, PARIDAD/HANDOFF, versión a dev).
