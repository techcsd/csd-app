# Release 2.58.1

> Reemplaza a `qa/release-2.58.0.md`: ese build no incluía el borrador de "Pedir
> material" (se agregó después, mismo día). Xaviel dijo "yes i tried" sobre
> 2.58.0-dev pero sin los detalles que pide este documento (¿se reprodujo el
> crash de la cámara 0.6x? ¿hay `logcat`?) — se le preguntó explícitamente y no
> hubo respuesta todavía, así que **ningún dato de esa prueba se copia aquí como
> si fuera un resultado confirmado**. Sin la línea `OK:` de abajo (con fecha),
> `release-check.mjs` sale en rojo y no se publica en prod — a propósito.

- **Equipo/dispositivo:** <pendiente — idealmente el Samsung de Jhonatan Roman
  (el que reportó el crash de la cámara 0.6x), o el de Xaviel si no está a mano>.
- **Versión de origen:** 2.57.1 (la que está publicada en prod hoy; 2.58.0 solo
  llegó a dev, nunca a prod).

## Qué probar

### 1. CT3a — "Ver conduce" sin empezar el proceso (Inventario › Recibir material)
1. Entra a un conduce pendiente SIN tocar "Recibir" — toca **"Ver conduce"**.
2. Confirma que ves folio, origen, obra, fecha, artículos y la foto del despacho,
   **en solo lectura** (sin cámara, sin firma, sin inputs de cantidad).
3. Sal con "Atrás" y revisa el banner del Home / "Documentación en proceso":
   **no debe aparecer ningún borrador** — mirar no debe haber creado nada.
4. Ahora toca **"Recibir"** (desde la lista o desde dentro de "Ver conduce") y
   confirma que el flujo completo (cantidades, fotos, firma) funciona igual que
   antes.

### 2. CT4 — Requisición "Enviando…" → "Enviada" + aviso de duplicado
1. Ve a **Pedir material**, arma una requisición y envíala.
2. En **Mis requisiciones** debe aparecer de inmediato arriba como **"Enviando…"**
   y cambiar sola a **"Enviada · REQ-xxxxxx"** en cuanto haya señal (no hace falta
   recargar la pantalla).
3. Sin salir, intenta enviar **la misma** requisición otra vez (mismos artículos,
   misma obra): debe salir un aviso **"¿Esta requisición ya la enviaste?"** con
   **"Ver la anterior"** y **"Enviar igual"**.
4. Prueba también **sin señal** (modo avión): la hoja de éxito debe decir
   *"Guardada. Se está enviando…"* (nunca "enviada" sin confirmación), y al volver
   la señal la fila pasa sola a "Enviada".

### 3. NUEVO en 2.58.1 — Borrador de "Pedir material"
1. En **Pedir material**, arma un carrito (agrega 2-3 artículos) y llega hasta el
   resumen (obra + urgencia).
2. **Sin enviar**, cierra la app por completo (deslízala fuera de recientes) o
   mátala desde Ajustes.
3. Reábrela: debe aparecer el banner **"Pendiente de terminar: Requisición de
   materiales"** en el Home (con botón "✕" para descartar) — tócalo y confirma que
   te lleva directo al resumen con el mismo carrito, obra y urgencia que tenías.
4. Envíala (o descártala desde el Home) y confirma que el borrador desaparece.

### 4. CT5 — Cámara 0.6x al recibir material (el crash reportado por Jhonatan)
**Esta es la prueba que más nos interesa — con `logcat` si es posible.**
1. Conecta el teléfono por USB con depuración activada.
2. Antes de abrir la app, en una terminal (PowerShell o Git Bash):
   ```
   adb logcat -c
   adb logcat > logcat-camara-06x.txt
   ```
   (dos comandos: el primero limpia el buffer viejo, el segundo vuelca TODO a un
   archivo — no hace falta teclear nada más ni usar `adb shell monkey`).
3. En la app: **Inventario › Recibir material** → abre un conduce → **"Recibir"**
   → en el paso de fotos, toca "Tomar foto", cambia a la lente **0.6x (ultra
   angular)** y toma la foto tal como lo hace Jhonatan.
4. Si la app se cierra/reinicia: **no vuelvas a tomar la foto todavía** — primero
   vuelve a abrir la app y confirma si aparece:
   - el banner **"Tienes una recepción sin terminar · Retomar / Descartar"** en el Home, y
   - que **"Retomar"** te devuelve al mismo conduce con las cantidades/notas/fotos
     que ya tenías (la firma se vuelve a pedir, eso es esperado).
5. Repite la captura con la lente 0.6x 2-3 veces más para confirmar si es
   reproducible siempre, a veces, o si fue un caso aislado.
6. Si tras 2 fallos seguidos de la cámara aparecen los botones **"Subir foto desde
   la galería"** y **"Usar la cámara de la app"**, prueba el segundo: debe abrir
   una cámara DENTRO de la app (no la del sistema) y dejarte tomar la foto sin
   salir.
7. Detén el logcat (`Ctrl+C` en esa terminal) y comparte el archivo
   `logcat-camara-06x.txt` — es lo único que puede confirmar la causa real (OOM,
   Activity destruida, excepción del plugin de cámara).

## Resultado

- **¿Se reprodujo el crash de la cámara 0.6x?: SÍ** — Xaviel confirmó que la app
  se cerró y se reinició al probarlo ("the app just got closed and restart"),
  igual que le pasó a Jhonatan. Esto confirma que el crash es real y sigue
  presente en 2.58.1 (los cambios de esta ronda son una red de seguridad —
  galería + cámara de la app tras 2 fallos, y el borrador de recepción para no
  perder lo capturado — no una corrección puntual del crash en sí).
- **Logcat: no se capturó.** La causa técnica exacta (OOM, Activity destruida,
  excepción del plugin de cámara) queda sin confirmar. Xaviel aceptó
  explícitamente esta brecha: "yes, i acept the gap, u can fix it."
- Banner de "recepción sin terminar", "Ver conduce" y el borrador de "Pedir
  material": no reportados con detalle individual.
- Fecha: 2026-10-21.

**Decisión:** Xaviel acepta promover a producción SABIENDO que el crash de la
cámara 0.6x se confirmó reproducible y que su causa técnica sigue sin
diagnosticarse (sin `logcat`) — la red de seguridad (galería/cámara de la app)
mitiga el impacto (no deja el flujo colgado) pero no es una corrección del
crash. Diagnosticarlo de verdad queda pendiente para una ronda futura, con
`logcat` real.

OK: Xaviel aceptó explícitamente la brecha del diagnóstico del crash y autorizó promover a producción de todas formas ("yes, i acept the gap, u can fix it"), 2026-10-21.
