# Release 2.58.5

- **Equipo/dispositivo:** teléfono de Xaviel.
- **Versión de origen:** 2.58.4 (la publicada en prod hoy) — la actualización in-app se probó DESDE esta versión.
- **Qué se probó:** actualización in-app 2.58.4 → 2.58.5, y el flujo de CZ1 (Registrar combustible): una echada con **fecha pasada** y **kilometraje menor al odómetro actual del vehículo pero correcto para esa fecha**.
- **Resultado:** OK — la actualización in-app funcionó, y la echada retroactiva se guardó sin el error "La lectura (…) no puede ser menor a la lectura actual del vehículo (…)" que bloqueaba este caso en 2.23.0–2.27.0.
- **Fecha:** 2026-10-27.

> Nota: CY24d (pantalla de estado Odoo en Mis solicitudes de compra, también en
> este build) no se reportó por separado en esta prueba — viene ya probada en
> dispositivo real de la sesión anterior (ver `HANDOFF.md`, ADENDO 26/10/2026).

OK: Xaviel probó en su teléfono — actualización in-app + la echada retroactiva de CZ1 — y confirmó que funciona ("funcionó bien"), 2026-10-27.
