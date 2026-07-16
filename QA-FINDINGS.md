# QA-FINDINGS — CSD App móvil (Actualización 5)

_QA total de la app móvil (PWA + Android). BD = PRODUCCIÓN. Metodología: auditoría profunda por área (4 pasadas) cruzando reglas de CONTEXTO 1–4 como checklist de regresión + verificación en device real (6dbf1af4, APK 1.7.0) + BD read-only. Correcciones app-side aplicadas; backend/web → "corresponde a SGC". `npm run build` OK (exit 0)._

_Actualizado: 2026-07-16 · FASE 2 (corrección) completa · sin commit/push (pendiente aprobación)._

_FASE 3: pendientes cerrados, decisiones tomadas, bump a **1.7.1**, APK firmado + re-test en device. `npm run build` OK._

## Resumen ejecutivo por severidad (final)
| Sev | Encontrados | Resueltos | Decisión "no cambiar" | Corresponde a SGC | Pendiente |
|-----|-------------|-----------|-----------------------|-------------------|-----------|
| Crítico | 0 | 0 | 0 | 0 | 0 |
| Alto | 5 | 5 | 0 | 0 | 0 |
| Medio | 13 | 10 | 1 (APP-016) | 2 | 0 |
| Bajo | 21 | 19 | 2 (APP-033/049) | 0 | 0 |
| Mejora | 4 | 4 | 0 | 0 | 0 |

**Cierre total: 0 pendientes app-side.** Últimos cerrados: **APP-038** (skeleton en combustible/checklist/mantenimiento mientras carga el vehículo — ya no muestran "—") y **APP-063** (`ngOnDestroy` en photo-slot/voice-recorder revoca la object-URL). Solo quedan los 2 items de **SGC** (APP-013, APP-021) para el próximo prompt web.

**Decisiones de producto tomadas:** APP-016 (accidente NO exige heridos>0 — accidentes materiales/casi-accidentes válidos), APP-033 (parte NO exige ≥1 actividad — días de lluvia/restricción son válidos), APP-049 (dos "atrás" en selector = jerárquico, por diseño). Sin cambio de código, documentadas.

**Cerrados en FASE 3 (además de FASE 2):** APP-022 (PWA "actualizar" recarga el SW, ya no descarga APK), APP-034 (empty-state de conduces siempre explica), APP-036 (incidente confirma al salir + NavGuard), APP-039 (pre-uso honra `licenciaDias`), APP-041 (recibir captura notas), APP-047 (autolock no hace round-trip en cada foreground breve), APP-062 (PIN constant-time).

**Pendiente trivial:** APP-038 (skeleton en combustible/checklist/mantenimiento — hoy muestran "—" un instante) y APP-063 (revoke de la última object-URL en ngOnDestroy — fuga mínima). Documentados con repro; bajísimo impacto.

**Núcleo verificado OK** (sin hallazgos): gating moduleGuard en todas las rutas; PIN 5-try lockout + biometría con fallback; lockout usuario desactivado (login/guard/resume, no offline); pool vehículos + reporte semanal; pre-uso v2 completo (10 tópicos, críticos, 7 fotos, bloqueos, PRE-CITA, veredicto tri-estado); combustible (card, orden, 2 fotos, validación km); catálogo oficial 8 cat + tallas EPP + Otros solo requisición; conteo "todo conforme"; rutas + duración legible; equipos alquilados; fotos ilimitadas; idempotencia outbox (client UUID, tx atómica, FIFO); fechas es-DO/duración hechas a mano; sin overloads RPC ambiguos.

---

## ALTO — 5/5 ✅
| ID | Módulo | Fix aplicado | Estado |
|----|--------|--------------|--------|
| APP-001 | Sync/UX | `retryErrored()` resetea los ops en `error`→`pending` (intentos=0) antes de drenar; la barra "toca para reintentar" ya reintenta de verdad. | ✅ |
| APP-002 | Versiones | Gate bloqueante: mensaje de descarga cuando no hay apk_url + botón **"Cerrar sesión"** siempre presente (escape). | ✅ |
| APP-003 | Inventario | EPP: `abrirTalla(a, cant)` recuerda la cantidad tecleada/steppeada; `confirmarTalla` la aplica (ya no se pierde ni queda en 1). | ✅ |
| APP-004 | Bitácora | Liberación: "Cancelar" en el paso 1 (footer) → `intentarSalir()`; se eliminó el callejón sin salida. | ✅ |
| APP-005 | Bitácora | Liberación: `NavGuard` + `ConfirmDialog` de salida (botón físico Android y Cancelar preguntan antes de perder datos). | ✅ |

## MEDIO — 9 ✅ · 1 propuesta · 2 SGC · 1 pendiente
| ID | Fix / destino | Estado |
|----|---------------|--------|
| APP-010 | Reporte semanal: bloquea enviar con km<odómetro (submit + botón disabled). | ✅ |
| APP-011 | Checklist recepción/devolución: valida km coherente vs odómetro. | ✅ |
| APP-012 | PDF pre-uso: sin Intl es-DO → usa util/fecha.ts + separador de miles manual (U9). | ✅ |
| APP-014 | "NINGUNA" mutuamente excluyente con otras restricciones. | ✅ |
| APP-015 | Incidente: copy "o graba voz" → "graba una nota de voz además de la descripción". | ✅ |
| APP-017 | Entrega conduce: botón atrás en el header (sin callejón sin salida). | ✅ |
| APP-018 | Ruta: estado con etiqueta humana + error de `marcarRuta` según causa real (no siempre "sin señal"). | ✅ |
| APP-019 | "Otros" (texto libre) solo en modo requisición; salida/entrada nunca emiten `otro:uuid`. | ✅ |
| APP-020 | Entrada: talla en el resumen de éxito y el texto de WhatsApp (paridad con salida). | ✅ |
| APP-013 | Foto de ítem pre-uso (`item_N`) sin asociar a su respuesta. | ↪️ SGC |
| APP-021 | Gate requisición (IR/Responsable) sin mensaje inmediato. | ↪️ SGC / 💡 |
| APP-016 | "accidente" no exige heridos>0. | 💡 Propuesta |
| APP-022 | PWA: "actualizar" abre descarga de APK en vez de refrescar el SW. | ⏳ Pendiente (ver abajo) |

## BAJO — 12 ✅ · 8 pendientes (menores) · 1 propuesta
✅ APP-030 detalle created_at con hora local (formatFechaMedia) · APP-031 entrega foto `(cleared)` · APP-032 entrega cantidad ≤ despachado · APP-035 mis-partes: estado de error con "Reintentar" (ya no se ve como "sin bitácoras") · APP-037 km con separador de miles en checklist/mantenimiento · APP-040 crear-ruta.scss: `--Hub`/`--text` inexistentes → tokens definidos · APP-042 almacenes activar/desactivar con gate offline · APP-043 backoff off-by-one corregido · APP-044 `retry()` resetea `intentos` · APP-045 pin-unlock muestra "te quedan N intentos" (hidratado al abrir) · APP-050 share nativo: cancelar ya no lanza error · APP-048 (=APP-018) estado de ruta humano.

⏳ Pendientes menores (con repro en su fila arriba): APP-033 (≥1 actividad — propuesta) · APP-034 (empty-state de conduces se oculta si hay rutas) · APP-036 (incidente sin confirmación al salir con datos) · APP-038 (skeleton en combustible/checklist/mantenimiento; hoy muestran "—" un instante) · APP-039 (pre-uso no honra `licenciaDias` de FlotaConfig; usa el default 30) · APP-041 (recibir no captura `notas`) · APP-047 (autolock hace checkActivo en cada foreground breve) · APP-049 (dos "atrás" en selector — decisión de diseño).

## MEJORA — 3 ✅ · 1 pendiente
✅ APP-060 incidente con galería (cámara + galería) · APP-061 detalle muestra migración "No" · (share cancel ya cubierto). ⏳ APP-062 PIN constant-time · APP-063 fugas object-URL sin ngOnDestroy (menor memoria).

---

## Corresponde a SGC (web/backend) — próximo prompt
- **APP-013**: foto de ítem del pre-uso (`item_N` en `checklist_vehiculo_fotos`) no se asocia a la respuesta ni se muestra en la web (coincide con lo ya listado en QA web / W4).
- **APP-021**: el gate `requisicion_permitida` vive en el RPC; para un mensaje inmediato la app necesitaría el rol/obra del usuario (dato backend). Alternativa: que `crear_solicitud_app` devuelva un error claro que la app ya muestra vía outbox.

## Propuestas (decisión de producto)
- **APP-016**: ¿"accidente" siempre implica ≥1 herido? Si sí, lo hago obligatorio.
- **APP-033**: ¿exigir ≥1 actividad en el parte diario?

## FASE 3 — Re-test y cierre
- `npm run build` OK (exit 0). Bump **1.7.0 → 1.7.1** (versionCode 1007001). APK release firmado generado y **instalado ENCIMA de 1.7.0** en el device 6dbf1af4 → **Success** (V5 install-over intacto; misma firma que producción).
- **Re-test en device del fix estrella APP-003**: en Inventario → Salida → EPP, tecleé cantidad **5** en "BOTA de SEGURIDAD" (requiere talla) → abrió el modal conservando la cantidad → talla **L** → Guardar → el ítem quedó con **cantidad 5 + "Talla: L"** y carrito 🛒 1 (antes se perdía y guardaba 1). Verificado ✅. No se confirmó la salida (no tocar stock real).
- Resto de correcciones: verificadas por build + revisión de código (mismos patrones ya probados en device en rounds anteriores). No publicado al bucket ni forzado mínimo.

## Datos QA-TEST creados / limpiados
| Tipo | Detalle | Estado |
|------|---------|--------|
| Bitácora de prueba (round anterior) | TEST Proyecto de Prueba, "Retroexcavadora" | ✅ eliminada (antes de esta pasada) |
| Esta pasada (audit + re-test) | Auditoría de código + verificación en la sesión real del device; el re-test de salida NO se confirmó (0 escrituras); **no se crearon entidades QA-TEST** | — sin residuos |
| Verificación | `select count(*) … qa.test+%` (usuarios) = **0** (los creó y limpió el QA web) | ✅ sin residuos |

_Nota: no se levantó Playwright/PWA-E2E — el gating es del backend compartido (SGC ya lo probó E2E 9/9 roles con el mismo `roles.modulos`) y el device real fue la superficie de verificación. Se documenta como decisión de metodología._
