# Prueba en teléfono — app 2.71.2 (conteo + Cambiar artículo + auto-reparación)

> Lista para que **Xaviel** la pase en un teléfono real. **Nadie la ha probado todavía**: todas las casillas están sin marcar.
> Entorno sugerido: `app-dev.` (PWA dev) o APK dev, con un usuario de rol almacén (p. ej. Raykler / `qa_*`). Anota el resultado también en `qa/release-2.71.2.md`.

Probado por:
Fecha:
Teléfono / navegador:
Versión de origen:

## 1. Conteo — estados reales de envío
Inventario › Conteo › elige almacén › cambia una cantidad › **Guardar conteo**.

- [ ] Con señal: se ve **Enviando…** y luego el sello de confirmado solo cuando el servidor respondió (no antes).
- [ ] La existencia del artículo en pantalla y en Inventario › Almacén cambia al nuevo valor después de confirmar.
- [ ] **Modo avión ACTIVADO** antes de guardar: se ve **Pendiente de sincronizar** (nunca «guardado» a secas).
- [ ] Apagar modo avión: pasa solo a Enviando → confirmado en menos de ~1 min (sin tocar nada).
- [ ] Forzar fallo (p. ej. modo avión + esperar ~14 min, o cantidad inválida): sale **Falló** con motivo legible y botón **Reintentar**; Reintentar lo envía cuando hay señal.
- [ ] La barra inferior de Inicio / Inventario muestra el conteo como pendiente mientras no se confirma (⏳) y como problema (⚠️) si falla.

## 2. Aviso de conteo atascado (> 2 min)
- [ ] Guardar un conteo en modo avión y esperar **2 min**: aparece el aviso persistente de conteo atascado en la pantalla de Conteo.
- [ ] (DT6, nuevo) Con señal pero cola trabada: la barra global dice «N sin enviar hace rato · toca para revisar» en vez de «se enviará solo». *(Difícil de provocar a propósito; si no se logra, déjalo sin marcar y anótalo.)*
- [ ] (DT6, nuevo) Un almacenista **sin** módulo Transporte ve el conteo pendiente en el badge del tile **Inventario**.

## 3. Artículo sin existencia previa
- [ ] **+ Agregar artículo** y contar un artículo que NO tenía fila de stock en ese almacén: se envía, se confirma y aparece con la cantidad contada en Almacén.

## 4. Selector — «Sin existencia aquí»
- [ ] En el selector de artículos de Conteo (y de Salida), los artículos sin stock en el almacén elegido aparecen marcados **«Sin existencia aquí»** y siguen siendo elegibles donde corresponde.

## 5. Cambiar artículo en una requisición
- [ ] Abrir una requisición con un renglón mal elegido › **Cambiar artículo** › elegir el correcto: el renglón queda con el artículo nuevo (verificar también en la web SGC).
- [ ] Sin señal: avisa con mensaje claro (sin texto técnico).

## 6. Auto-reparación de chunk tras un deploy
- [ ] Con la PWA abierta en una pantalla vieja, hacer un deploy nuevo a dev y navegar a una pantalla que no se haya abierto antes: la app se **repara y recarga sola** (no queda pantalla en blanco ni error `text/html is not a valid JavaScript MIME type`).
- [ ] **Antes** de ese deploy, dejar un conteo en la cola (modo avión). Después de la reparación y recarga, el conteo **sigue pendiente** y se envía al volver la señal (la reparación no borra la cola).

## Nota Odoo (no es un fallo de esta versión)
En almacenes con Odoo como fuente de stock, un conteo desde la app puede revertirse en minutos (ver `docs/DT-conteo-diagnostico.md`). Para un ajuste que quede, usar Conteo físico en la web.

## Verificación asistida (Claude, 20-nov-2026) — NO sustituye la prueba de Xaviel
Teléfono M2101K6G (Chrome, PWA servida desde el código de PR #53 = 2.71.3) contra **dev** (`fzfrnrvn`), usuario `QA guarda_almacen`, almacén BRISAS CITY CENTER, artículo BIROTE 2X4 (1000 → 999). Solo se observó; las casillas de arriba siguen sin marcar.
- Modo avión + Guardar: pantalla «Pendiente de sincronizar … El stock aún no cambió» (no «guardado» a secas). Observado.
- Fuera de Conteo (Inventario): barra global «Sin señal · 1 se enviarán solos». Observado.
- Al quitar el modo avión: «Todo enviado» en ≈40 s sin tocar nada. Observado.
- Servidor dev (`stock_por_bodega`): cantidad 999, `updated_at` 17:23:11Z = momento del reenvío. Confirmado por consulta de solo lectura.
- NO probado: estado «Falló», aviso > 2 min, barra `stale`, badge del tile Inventario, selector «Sin existencia aquí», Cambiar artículo, auto-reparación tras deploy, almacenes con fuente Odoo.
- Nota: el dato de dev quedó en 999 (antes 1000).
