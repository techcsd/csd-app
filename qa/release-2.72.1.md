# Release 2.72.1
- Equipo/dispositivo: teléfono propio de Xaviel (modelo no indicado).
- Versión de origen: no indicada por Xaviel (la anterior publicada en prod es 2.72.0).
- Qué se probó: Xaviel informó «ya probe en un telefono» (24-nov-2026) sobre el hotfix en dev. No dio el detalle; Claude no lo vio ni lo infiere.
- Qué cambia: arranque en iPhone — si el service worker sirve un index.html viejo (script main-*.js perdido tras un deploy) o no pinta en 8 s, la app limpia SW y cachés y recarga una vez, en vez de quedarse en blanco.
- Resultado: OK según Xaviel (sin detalle). Build verde (Claude). NO verificado por Claude en iPhone.
- Fecha: 2026-11-24
**OK de Xaviel** 2026-11-24: «termina todo y llevalo a prod, ya probe en un telefono. tienes mi ok»
