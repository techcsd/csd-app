# Release 2.73.4
- Equipo/dispositivo: ninguno; solo revisión de código y compilación. No se probó en teléfono.
- Versión de origen: 2.73.3.
- Causa: en `pedir.ts` (Nueva requisición) el autosave volvía a guardar el carrito justo después de enviar; la siguiente requisición lo restauraba y saltaba al resumen, y al enviarla se duplicaba.
- Qué cambia: el autosave no guarda en la hoja «éxito» y el borrado del borrador se espera antes de seguir.
- Qué verificó Claude: el compilador no marca errores en `pedir.ts`. No hay prueba automática de esta pantalla.
- Qué falta: probar en un teléfono enviar una requisición y abrir otra (no debe reaparecer la anterior).
- Resultado: sin verificar en dispositivo.
- Fecha: 2026-11-26

**OK de Xaviel** (2026-11-26): «tienes mi OK. --yes» (hotfix de requisición duplicada a dev y prod).
