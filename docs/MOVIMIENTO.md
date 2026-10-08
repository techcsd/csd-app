# MOVIMIENTO.md — Sistema de movimiento de la app (CJ1-CJ4)

> Regla de la casa (CLAUDE.md): **todo "éxito" de la app vive en esta tabla** con su
> nivel. No se añade movimiento que no esté aquí. Niveles por defecto (CONTEXTO-43
> §CJ4). Paridad con el `docs/MOVIMIENTO.md` de la web (mismo contrato
> `MotionService.celebrar(tipo, datos)`). Todo es `transform`/`opacity`; nada de
> librerías nuevas. Reduce-motion (SO **o** ajuste "Animaciones: reducidas") lo anula.

## Tokens (src/styles/_tokens.scss)
`--motion-fast 150ms` · `--motion-base 220ms` · `--motion-slow 320ms` · `--motion-hero 1600ms` · `--ease-out cubic-bezier(.2,.8,.2,1)` · `--ease-in cubic-bezier(.5,0,.75,0)`.

## Infraestructura
- **Crossfade entre pantallas (CJ1):** `withViewTransitions({ skipInitialTransition:true })` en `app.config.ts` + `::view-transition-*(root)` en `styles.scss` (fundido + subida 8px, 220ms). Sin soporte = sin animación.
- **Ajuste de usuario (CJ1):** `MotionService` (`core/services/motion.service.ts`) guarda `completas|reducidas` por dispositivo y pone `.motion-reduced` en `<html>`. Selector en **Perfil › Animaciones**. `motion.reducido()` = la fuente única para que las celebraciones se salten.
- **Celebración (CJ2/CJ3) — HECHO:** componente global `app-celebracion` (`shared/ui/celebracion`, montado en `app.html`) + `MotionService.celebrar(Celebracion)`. Copia de los mocks `CJ2-conduce-creado.dc.html` / `CJ3-ruta-creada.dc.html` (keyframes/tiempos idénticos). No bloquea, se salta tocando el velo, `aria-live`, reduce-motion (SO o ajuste) = solo el check, variante **corta** 0,8s al encolar offline, vibración corta (`@capacitor/haptics`, solo nativo).

## Niveles
- **Grande** (≤1,6s, overlay `app-celebracion`): solo **conduce creado** y **ruta creada**.
- **Mediano** (0,8s, sin overlay — caja/gota con check): recepción confirmada, requisición enviada/aprobada, "todo enviado" al vaciar la cola offline, combustible registrado.
- **Simple** (el resto): el toast con check que ya existe (`ToastService.success`).

## Mapa momento → archivo:línea → nivel
| Momento | Archivo:línea | Nivel | Animación |
|---|---|---|---|
| Conduce interno creado/emitido | `pages/transporte/generar-conduce/generar-conduce.ts` (éxito de enviar) | **grande** | papel que sube → sello EMITIDO → carpeta (CJ2) |
| Conduce externo creado | `pages/transporte/conduce-externo/conduce-externo.ts` (éxito de crear) | **grande** | CJ2 |
| Comprar en ferretería | `pages/transporte/ferreteria/ferreteria.ts:167` | mediano | es una COMPRA, no un conduce → check (no CJ2) |
| Ruta creada | `pages/transporte/rutas/crear-ruta.ts:830` (`done.set(true)` tras `crear_ruta_app`) | **grande** | camión CSD cruzando + pines (CJ3) |
| Ruta iniciada / terminada | `pages/transporte/conduces-pendientes/conduces-pendientes.ts:237`; fin de ruta | **grande (corto 0,8s)** | variante corta del camión, sin velo (CJ3) |
| Recepción de material confirmada | `pages/inventario/recibir/recibir.ts:137,289` | mediano | caja con check |
| Requisición enviada | `pages/solicitudes/*` (crear/enviar) | mediano | check |
| Requisición aprobada | `pages/solicitudes/detalle/detalle.ts:276` | mediano | check |
| Combustible registrado | `pages/transporte/combustible/combustible.ts` (éxito de submit) | mediano | gota que llena |
| "Todo enviado" al vaciar la cola offline | sync badge / al drenar el outbox | mediano | check |
| Echada aprobada/rechazada | `pages/transporte/por-aprobar/por-aprobar.ts:145,181,211` | simple | toast con check |
| Uso de vehículo tomado/soltado/recibido | `pages/transporte/uso-vehiculo/uso-vehiculo.ts:215,237` | simple | toast con check |
| Conduce firmado / parada entregada | `pages/transporte/conduce-detalle/conduce-detalle.ts:179`; `conduces/conduces.ts:356` | simple | toast con check |
| Solicitud de compra / movimiento enviada | `pages/compras/solicitud-compra/solicitud-compra.ts:155`; `transporte/solicitud-movimiento/crear-solicitud-movimiento.ts:183` | simple | toast con check |
| Documento en cola, PDF guardado, transferencia ofrecida, etc. | varios `toast.success` | simple | toast con check |

**Offline:** al **encolar** (sin señal), la celebración grande se degrada a la versión corta *"Guardado, se enviará"* (mediano); la grande **no se repite** al sincronizar después.

## Estado
- ✅ CJ1 (tokens, View Transitions, ajuste de usuario), CJ4 (esta tabla), CJ2/CJ3 (`app-celebracion` + `celebrar()`, disparadores en generar-conduce/conduce-externo/crear-ruta) — 2.45.0.
- ⏳ Los **medianos con check** (recepción/requisición/combustible/"todo enviado") usan hoy el toast; subirlos a la caja/gota con check es refinamiento futuro.
