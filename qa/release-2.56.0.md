# Release 2.56.0

> CR4 — tercera vez que se iba a saltar la prueba del teléfono (2.54.0 y 2.55.0 ya
> salieron sin ella, ambas con tu OK explícito de saltarla). **Esta vez no**: 2.56.0
> no se publica en prod hasta que esta hoja tenga una línea `OK:` con fecha tuya que
> diga que la actualización in-app funcionó de verdad (o que falló, con el detalle).
> Nadie más puede poner esa línea por ti — ni "parece que debería funcionar" cuenta.

- **Equipo/dispositivo:** Samsung SM-A205U, app `com.constructorasd.csdapp.dev`.
- **Versión de origen:** 2.51.0-dev (sigue siendo la instalada — nadie ha tocado ese
  teléfono desde que quedó así hace varias rondas).

## Qué hacer tú mismo, con tus manos (el harness no toca el teclado del teléfono)

1. Toma el Samsung y ábrelo normal (tu PIN del teléfono, tu huella — lo que uses).
2. Abre la app CSD App (la que dice "DEV" en el ícono). Si pide iniciar sesión,
   entra con tu usuario real como siempre.
3. Ve a **Perfil › Buscar actualización** (botón 🔄 arriba del todo en Perfil). Si
   detecta una versión nueva, sigue el flujo normal de instalación (puede pedirte
   permiso de "Instalar apps desconocidas" la primera vez — permítelo solo para
   esta app si te lo pide).
4. Si la app NO detecta nada nuevo sola, dime y te paso el link directo al APK
   `csd-app-2.56.0.apk` del bucket dev para que lo instales a mano (mismo resultado,
   solo cambia cómo llega el archivo al teléfono).
5. Confirma que instala **sin** el error "Aplicación no instalada" (si sale, casi
   siempre es que el teléfono se quedó sin espacio — revisa Ajustes › Almacenamiento
   antes de reintentar, no es un problema de firma).
6. Con 2.56.0 ya instalada y abierta, dale un vistazo rápido a lo nuevo de esta
   ronda (todo bajo **Perfil › Claude y el SGC**):
   - El estado de conexión se ve bien (conectado/no conectado, sin texto roto).
   - Si hay algún borrador pendiente de prueba, que "Revisar y confirmar" abra la
     pantalla y se lea bien en la pantalla angosta del teléfono.
   - Que "Desconectar Claude" pida confirmación antes de actuar.
7. Anota abajo qué tal fue (actualizó sin trabarse, algo se vio raro, algo lento).

## Si algo falla — cómo lo vemos sin que tengas que escribir nada técnico

Conecta el teléfono por USB a tu computadora y dime "falló, ahí está conectado" —
desde ahí yo puedo leer lo que pasó con `adb logcat` (una lectura pasiva de lo que
el teléfono ya hizo; no necesito que tú teclees ni toques nada más en la pantalla
para eso). Si prefieres, también sirve una captura de pantalla del error.

## Resultado

- Qué se probó: _(completar)_
- ¿Actualizó sin trabarse?: _(sí / no, detalle)_
- ¿Algo raro en pantalla angosta (390px)?: _(sí / no, detalle)_
- ¿Algo lento con datos reales?: _(sí / no, detalle)_
- Fecha: _(completar)_

<!--
  La línea de abajo la escribes TÚ (Xaviel), no Claude Code. Formato exacto que
  exige scripts/release-check.mjs (CR3 — gate de negaciones, ver scripts/lib/ok-linea.mjs):
  una línea que EMPIECE con "OK:" o "**OK de Xaviel**", con una FECHA en esa misma
  línea, y SIN las palabras "pendiente/falta/no/skip" en lo que sigue.

  Ejemplo si funcionó:
  OK: Xaviel probó en el Samsung el 2026-10-20, actualizó de 2.51.0-dev a 2.56.0 sin problema.

  Ejemplo si falló (igual cuenta como prueba real, solo no destraba el release hasta arreglarlo):
  OK: Xaviel probó en el Samsung el 2026-10-20 — la instalación falló con "Aplicación no instalada", pendiente investigar.
    (ojo: esta línea FALLA el gate a propósito por la palabra "pendiente" — si falló, mejor
     escribe directo qué pasó sin esa palabra, o avísame en el chat y lo documentamos juntos)
-->
