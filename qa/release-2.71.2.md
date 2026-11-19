# Release 2.71.2

- Equipo/dispositivo: Claude Code asistiendo a Xaviel; web dev (dev.sgcconstructorasd.com) con usuario de rol Raykler. NO se probó en teléfono real.
- Versión de origen: 2.71.1
- Qué se probó: el servidor que usa la app (registrar_conteo_app crea fila de stock de un artículo sin stock previo; reemplazar_articulo_renglon_requisicion verificado en dev y aplicado en prod). Build y 66 tests de la app en verde. Los cambios de pantalla de la app (estados del conteo Enviando/Pendiente/Falló, selector con «Sin existencia aquí», Cambiar artículo, aviso de foto fallida, auto-reparación de chunk) NO se ejercitaron en dispositivo.
- Resultado: hotfix sin prueba humana de la app (riesgo aceptado por Xaviel: «hazlo todo, incluso el merge y la migración a prod», 2026-11-19).
- Fecha: 2026-11-19

OK: Xaviel autorizó en el chat el merge y la migración a prod del hotfix Raykler 2026-11-19.
