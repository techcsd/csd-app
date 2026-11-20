# Prueba en teléfono — app 2.71.4 (aviso + aplicar como Conteo físico en almacenes Odoo)

> Para **Xaviel**. **Nadie lo ha probado con datos reales**: todas las casillas sin marcar.
> En **dev** no hay almacenes con Odoo (0 de 28), así que el aviso real solo se ve en **prod** con un almacén Odoo (16 de 29). Solo lectura: NO guardes conteos en prod para probar.

Probado por:
Fecha:
Teléfono / navegador:
Versión de origen:

- [ ] Prod (2.71.4), Inventario › Conteo › un almacén **con Odoo**: aparece la nota «En este almacén Odoo manda el stock. Para que tu ajuste quede, la app lo aplica como Conteo físico…» y el botón dice **Aplicar como conteo físico**.
- [ ] Cambiar a un almacén **sin Odoo**: la nota desaparece.
- [ ] Cambiar una cantidad y pulsar Aplicar: sale la confirmación con el n.º de artículos; «Sí, aplicar» → pantalla «Ajuste aplicado». (**Escribe en prod: solo con OK de Xaviel y en un almacén/artículo acordado.**)
- [ ] **LA PRUEBA CLAVE:** pasados ~10 min, ese ajuste SIGUE en Inventario › Almacén (no lo revirtió Odoo). Si se revierte, el flujo no sirve para Odoo y hay que avisar a SGC.
- [ ] Verlo también en la web (Conteo físico del SGC: queda como aplicado, con motivo y usuario).
- [ ] Sin señal en un almacén Odoo: Aplicar avisa que necesita conexión (no encola nada).
- [ ] Sin cambios de cantidad: «No cambiaste ninguna cantidad».
- [ ] Almacén SIN Odoo: sigue «Guardar conteo» con el flujo de antes (Enviando… / Pendiente).
- [ ] Modo avión con el almacén Odoo ya cargado: la pantalla abre y se usa normal (sin error técnico); sin caché previa no hay nota ni botón de aplicar.
- [ ] Idioma English y Kreyòl: la nota sale traducida.
- [ ] Un usuario sin acceso a ese almacén / sin señal al abrir: la pantalla abre sin romperse y sin aviso.
