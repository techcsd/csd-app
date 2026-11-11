# Release 2.68.0

- **Equipo/dispositivo:** pendiente — falta prueba en teléfono Android real de
  Xaviel (actualización in-app desde 2.67.0).
- **Versión de origen:** 2.67.0 (la publicada en prod).
- **Qué probar:**
  - [ ] Perfil → "Claude: Setup y skills" abre el módulo nuevo (Inicio/Skills/Crear/Encuesta).
  - [ ] Inicio: marcar "Conecté el SGC" abre Perfil → Claude (conexión existente); marcar
        "Probé una pregunta" actualiza el checklist (0 a 4).
  - [ ] Skills: con red, descargar una skill de empresa guarda un `.zip` en Documentos; compartir
        abre la hoja nativa.
  - [ ] Skills: sin red, los botones de descargar/compartir avisan "Necesitas conexión" (no fallan en silencio).
  - [ ] Crear: llenar Título/Qué hace/Cuándo usarla y guardar crea una skill personal (ver vista
        previa del SKILL.md antes de guardar); offline queda "En cola" y se crea al reconectar.
  - [ ] Encuesta: responder y guardar; volver a abrir muestra "Ya respondiste" y permite editar.
  - [ ] Conduce: abrir desde "Pendiente entrega"/"Por firmar"/Historial/"Por implementar" muestra
        "← Anterior · N de M · Siguiente →"; abrir directo desde una notificación NO muestra esos
        botones (sin lista = sin nav).
  - [ ] Conduce: "Siguiente pendiente para mí" salta a otro conduce pendiente (o avisa "sin
        pendientes" si no hay otro).
  - [ ] Combustible/Mantenimiento: capturar un km válido contra el historial del vehículo ya NO
        da un error de servidor (antes fallaba siempre tras DH2 en prod — ver CONTEXTO DM §2.2).
  - [ ] GPS: un chequeo de "¿hay GPS?" (p. ej. abrir una pantalla que lo exige) responde más rápido
        que antes cuando hay señal; negar el permiso no genera un reporte de error.
- **Resultado:** PENDIENTE — falta que Xaviel pruebe la actualización in-app en un
  dispositivo real antes de abrir el PR hacia `main` (regla 18 / CP5).
- **Fecha:** 2026-11-11 (construido); pendiente de prueba.
