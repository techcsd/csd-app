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
- **Resultado:** OK PARCIAL — Xaviel confirmó en conversación (2026-11-11) "i test
  it, it works good, continue working", pero **no especificó** si probó la PWA o
  un APK instalado — y en ese momento **no existía ningún APK 2.68.0** (recién se
  construyó/publicó después de su OK). Autoriza el pipeline hasta `dev` (esta
  sesión), pero el checklist de CP5/CL4 — **actualización in-app desde 2.67.0 en
  un teléfono Android real** — sigue pendiente una vez que el APK dev 2.68.0 esté
  publicado. No marcar esto como cumplido hasta esa prueba específica.
- **Fecha:** 2026-11-11.

OK: Xaviel, 2026-11-11 — "i test it, it works good, continue working". Autoriza
avanzar el pipeline hasta `dev` (push/merge/APK dev). **No** autoriza aún PR a
`main`/prod — falta la prueba de actualización in-app CP5 sobre el APK real.
