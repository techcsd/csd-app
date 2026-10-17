# Release 2.55.0

- Equipo/dispositivo: Samsung SM-A205U, app `com.constructorasd.csdapp.dev`.
- Versión de origen: 2.51.0-dev (la que sigue instalada en el teléfono — la prueba de 2.54.0 nunca se completó, ver `qa/release-2.54.0.md`).
- Qué tocar (de arranque a confirmar la actualización):
  1. Abrir la app en 2.51.0-dev con el teléfono en la mano (login real, con tus manos — el harness no debe teclear la contraseña).
  2. Dejar que la app detecte la actualización in-app (o forzarla desde Perfil › Acerca de › Buscar actualización) hacia 2.54.0 primero, y si ya está disponible, seguir hasta 2.55.0.
  3. Confirmar que instala sin "Aplicación no instalada" (ver memoria `app-not-installed-real-cause-storage` si pasa — normalmente es disco lleno, no firma).
  4. Con 2.55.0 instalada, dar un vistazo a lo nuevo de esta ronda: Importar (vehículos/choferes) con la revisión de fotos + modal de resultado; Dev notes editando una nota de prueba; Auditoría › Actividad con una búsqueda real; Compras tecnológicas › una ficha con artículos/ITBIS/total.
  5. Capturar: ¿actualizó sin trabarse? ¿algo se vio raro en pantallas angostas (390px)? ¿algo lento con datos reales?
- Qué capturar si algo falla: captura de pantalla + `adb logcat` del momento (sin tocar el teclado del dispositivo tú mismo mientras Xaviel está logueado).
- Resultado: la prueba real en el Samsung NO se hizo (mismo pendiente arrastrado desde 2.54.0 — el teléfono sigue en 2.51.0-dev). Esta sesión confirmó el hueco explícitamente a Xaviel (release-check mostrando 🔴 en el check "breathe") y le preguntó cómo seguir.
- Fecha: 2026-10-17

OK: Xaviel autorizó explícitamente saltar la prueba de dispositivo real y seguir hasta producción en esta misma sesión ("Skip the phone test again, give explicit OK" — elegido en una pregunta directa de la sesión que explicó el hueco antes de actuar). Segunda vez seguida que se salta (ver `qa/release-2.54.0.md`) — el teléfono sigue sin confirmarse en 2.51.0-dev; recomendado instalar 2.55.0 a mano en el Samsung cuando se pueda, aunque sea después del release.
