# Contratos listos desde la web (SGC) para PROMPT-4 (app) — ronda AT, 20/08/2026

La web (SGC, `dev\SGC`) ya está desplegada en **1.88.1** y **todas las migraciones + edge
functions están aplicadas a prod**. Este archivo lista lo que el backend/contratos ya
exponen para que la **app (csd-app)** implemente su parte de la ronda AT sin tener que
tocar la BD. Fuente: `PROMPT-4-CSD-APP.md` de `imp 19082026`.

> Regla: SGC es el padre. Todo esto ya existe server-side; la app solo consume.

## AT4 — Selector de AYUDANTE en los flujos que puntúan (incentivo)
El incentivo cuenta al **titular** y suma **igual** al **ayudante** (decisión de Xaviel:
1 ayudante, al crear la actividad). Backend listo:
- `sgc.marcar_ayudante(p_activity_type text, p_activity_id uuid, p_usuario_id uuid)` →
  `activity_type ∈ ('ruta','conduce','echada','inspeccion','reporte_semanal')`. Valida que
  el titular no sea su propio ayudante y notifica al ayudante.
- `sgc.quitar_ayudante(p_activity_type, p_activity_id, p_usuario_id)`.
- La app debe: al crear ruta/conduce/echada/inspección/reporte, ofrecer "¿Llevas ayudante?"
  → dropdown de choferes/personal → llamar `marcar_ayudante(tipo, id_de_la_actividad, usuario_ayudante)`.

## AT2 — "Mi rendimiento" del chofer en la app
El chofer NO ve el módulo Incentivos; ve solo lo suyo:
- `sgc.incentivo_mi_rendimiento()` → filas por semana `{informe_id, anio, semana, inicio, fin,
  puntaje, minimo, cumplio, conteos, decision, decidido_en}` (RLS: solo `auth.uid()`).
- La notificación de "incentivo aprobado" ya llega vía `sgc.notificar(...ruta='/mi-rendimiento')`.
  En la app, mapear esa ruta a la vista "Mi rendimiento".
- `conteos` es jsonb `{renglon:{propio,ayudante,puntos,refs:[{id,tipo,fecha,ayudante}]}}` —
  cada ref es clickable a su registro.

## AT16 — Selector de RECEPTOR al crear/entregar el conduce
- Fuente del selector: `sgc.receptores_disponibles(p_proyecto_id uuid, p_bodega_id uuid)` →
  `{id, nombre, detalle, vinculado}` (responsables de la obra + can_confirm + ingeniero_campo/guarda_almacen).
- Para dirigir la confirmación al elegido: setear `salidas_inventario.firma_pendiente_usuario_id`
  = usuario elegido. Esa columna YA alimenta la matriz `confirmadores_de_conduce` (rama B),
  así el elegido recibe la notificación dirigida y cualquier autorizado de la obra puede confirmar.
- Si el receptor no es usuario del sistema → firma en persona (AS1, ya existe).

## AT8 / AT10 / AT22 — paridad con lo que hizo la web
- **AT8**: al confirmar una entrega ya hecha por el chofer, el confirmador NO re-firma por el
  emisor. En la web el bloque emisor es solo-lectura si ya firmó. Revisar el flujo equivalente
  en la app (usar `conduce_confirmar_receptor` para confirmación remota, no `entregar_conduce`).
- **AT10**: conduces marcables como prueba — RPC genérico `marcar_movimiento_inventario_prueba('salidas_inventario', id, bool)` (admin) ya existe.
- **AT22**: fecha + hora 12h en detalles (la web usa `formatFechaHoraDisplay`); homologar en la app.

## AT13 — Link de ubicación pegado al crear ruta
- Reutilizar el parser de links de proyectos: edge `resolve-maps-link` (AM7/AM8) que resuelve
  `maps.app.goo.gl`, `goo.gl/maps`, `?q=lat,lng`, `@lat,lng`, coords a pelo → lat/lng + dirección.
- La app debe aceptar pegar el link en el paso de ubicación de crear-ruta, resolver, centrar el
  mapa y poner el pin para que el chofer confirme.

## AT9 — Cámara no abre en iPhone (Raykler, iPhone 13, PWA/iOS)
- Es terreno PWA iOS/Safari (no Android/Capacitor). Candidatos en orden: contexto seguro (HTTPS),
  PWA instalada vs Safari, permiso denegado a nivel de sitio, `getUserMedia` con constraints
  imposibles. **Instrumentar el `catch`** para mostrar el error real en pantalla
  (`NotAllowedError`/`NotFoundError`/`OverconstrainedError`/`NotReadableError`). Fallback:
  `<input type="file" accept="image/*" capture="environment">` (más confiable en iOS) + pantalla
  de ayuda "Ajustes → Safari → Cámara → Permitir". Nunca dejar al usuario sin poder completar.

## AT24 — orden de rutas (más nueva primero)
- La web ya ordena `fecha desc, created_at desc`. En la app, revisar Mis rutas: `mis_rutas_hoy`
  (RPC) ya viene `fecha desc`; verificar que la UI no re-ordene al revés.

## AT7 — que el `article_id` viaje desde el origen
- En la app, al crear una requisición eligiendo del catálogo, **persistir `articulo_id`** en el
  renglón (no solo texto). La web ya lo preselecciona si viene; el fix de raíz es que la app lo mande.

## Datos maestros ya cargados por la web (no re-crear)
- Ingenieros creados+invitados y asignados a obras (Mercedes, Ortiz, Ocsena, Camacho, Lapaix,
  Emmanuel Peralta, Wagner De los Santos + existentes). Rol `ingeniero_campo` (módulos bitacora,
  ingenieria, compras). Sócrates = jefe_ingenieros. Brisas City Center = cerrada.
- Maestros encargados sin correo: **por decisión de Xaviel, no se hace nada por ahora.**
