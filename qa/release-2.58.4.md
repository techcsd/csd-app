# Release 2.58.4

- **Equipo/dispositivo:** <pendiente — Samsung de Xaviel>.
- **Versión de origen:** la que esté publicada en **prod** al momento de probar
  (confirma en Perfil/Ajustes antes de actualizar).

## Qué probar (ronda CX — CX3.5)

### 1. Vista rápida de una requisición "Por despachar"
1. "Entrar como" Raykler (o cualquier usuario con el módulo Inventario que vea
   Transporte › Despachos).
2. En "Por despachar", **toca el cuerpo de una tarjeta** (no el botón
   "Despachar"): debe abrirse una hoja desde abajo con el contenido de la
   requisición — renglones (cantidad, unidad, talla si aplica), solicitante,
   urgencia, fecha de necesidad (si tiene), notas (si tiene) y "hace N días".
3. Confirma que **abrir la vista rápida no hace nada**: no se crea ningún
   conduce, no cambia el estado de la requisición, no aparece en "Mis
   envíos"/outbox.
4. Dentro de la hoja, toca **"Despachar"**: debe cerrar la hoja y llevarte al
   flujo normal de generar el conduce (el mismo de siempre, sin cambios).
5. En la tarjeta misma, el botón **"Despachar"** (la línea de abajo) sigue
   funcionando igual que antes — directo al flujo, sin pasar por la vista
   rápida.
6. Cierra la hoja tocando fuera (el fondo oscuro) y con la ✕: ambas deben
   cerrarla sin iniciar nada.

### 2. Sin señal
1. Abre "Por despachar" con señal (para que la lista cargue).
2. Activa modo avión.
3. Toca una tarjeta que **ya habías abierto antes** en esta sesión: debe abrir
   la vista rápida con el contenido de la última vez (sin pedir red).
4. Toca una tarjeta que **nunca habías abierto**: debe mostrar un aviso claro
   ("No pudimos cargar el contenido…") con un botón **Reintentar**, no una
   pantalla en blanco ni un error técnico.

### 3. Teclado / accesibilidad (si pruebas con teclado Bluetooth o TalkBack)
Tabula hasta una tarjeta y presiona Enter o Espacio: debe abrir la vista
rápida igual que el toque, y el foco debe verse resaltado.

## Resultado

Xaviel probó en su teléfono y confirmó que funciona ("ok, ya lo testie,
continue working" — chat de esta sesión). No dejó detalle punto por punto del
checklist de arriba; se toma como visto bueno general de la ronda.

OK: Xaviel probó la vista rápida de despacho (2.58.4) y confirmó que funciona, 2026-10-25.

## Fecha

2026-10-25
