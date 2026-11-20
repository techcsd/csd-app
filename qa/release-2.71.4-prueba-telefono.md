# Prueba en teléfono — app 2.71.4 (aviso «Odoo manda el stock»)

> Para **Xaviel**. **Nadie lo ha probado con datos reales**: todas las casillas sin marcar.
> En **dev** no hay almacenes con Odoo (0 de 28), así que el aviso real solo se ve en **prod** con un almacén Odoo (16 de 29). Solo lectura: NO guardes conteos en prod para probar.

Probado por:
Fecha:
Teléfono / navegador:
Versión de origen:

- [ ] Prod (2.71.4), Inventario › Conteo › un almacén **con Odoo**: aparece la nota «En este almacén Odoo manda el stock…» (fondo de aviso) antes de la lista.
- [ ] Cambiar a un almacén **sin Odoo**: la nota desaparece.
- [ ] Con la nota visible, el botón Guardar sigue funcionando igual (no bloquea).
- [ ] Modo avión con el almacén Odoo ya cargado: la pantalla abre y se usa normal (sin error técnico); sin caché previa no hay nota.
- [ ] Idioma English y Kreyòl: la nota sale traducida.
- [ ] Un usuario sin acceso a ese almacén / sin señal al abrir: la pantalla abre sin romperse y sin aviso.
