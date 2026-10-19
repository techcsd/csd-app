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

- Qué se probó: la prueba real en el Samsung **no se hizo** (tercera vez consecutiva:
  2.54.0, 2.55.0 y ahora 2.56.0). El teléfono sigue en 2.51.0-dev sin confirmar nunca
  que la actualización in-app (CO1) funciona de verdad en hardware real.
- ¿Actualizó sin trabarse?: sin dato — no se instaló.
- ¿Algo raro en pantalla angosta (390px)?: sin dato — las pantallas nuevas (Perfil ›
  Claude, `/borrador/:id`) tampoco se vieron con clic-a-clic real en esta ronda (el
  intento de montar una sesión de prueba para verificarlas fue bloqueado por el
  clasificador de seguridad del harness).
- ¿Algo lento con datos reales?: sin dato.
- Fecha: 2026-10-19.

**Decisión explícita de Xaviel (tercera vez, documentada a propósito — CR4 pedía
exactamente esto, no un silencio):** esta misma sesión le mostró el hueco en claro
(riesgo acumulado de 3 rondas sin verificar el updater en hardware real, pantallas
nuevas sin clic-a-clic) y le preguntó con una decisión estructurada de dos opciones
("probar en el Samsung primero" vs. "saltar la prueba otra vez y publicar"). Xaviel
eligió explícitamente **"Yes, skip the phone test again — ship to prod now"**, y lo
confirmó de nuevo en el chat ("finish all the work and do the push to production").

OK: Xaviel autorizó explícitamente publicar 2.56.0 a producción el 2026-10-19 sin la prueba física del Samsung (tercera vez consecutiva), con el riesgo documentado arriba.
