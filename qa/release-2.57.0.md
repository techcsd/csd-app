# Release 2.57.0

> CS9 — la prueba del teléfono sigue pendiente. El Samsung lleva en **2.51.0-dev**
> desde hace varias rondas (2.54.0, 2.55.0, 2.56.0 salieron sin probarla, las tres
> con tu OK explícito de saltarla). Esta hoja no se completa sola — **2.57.0 no se
> publica en prod hasta que tenga una línea `OK:` con fecha tuya**, diciendo que la
> actualización in-app funcionó de verdad (o que falló, con el detalle).

- **Equipo/dispositivo:** Samsung SM-A205U, app `com.constructorasd.csdapp.dev`.
- **Versión de origen:** 2.51.0-dev (sigue siendo la instalada).

## Qué hacer tú mismo, con tus manos (el harness no toca el teclado del teléfono)

1. Toma el Samsung y ábrelo normal (tu PIN del teléfono, tu huella — lo que uses).
2. Abre la app CSD App (la que dice "DEV" en el ícono). Si pide iniciar sesión,
   entra con tu usuario real como siempre.
3. Ve a **Perfil › Buscar actualización** (botón 🔄 arriba del todo en Perfil). Si
   detecta 2.57.0, sigue el flujo normal de instalación (puede pedirte permiso de
   "Instalar apps desconocidas" la primera vez — permítelo solo para esta app).
4. Si la app NO detecta nada nuevo sola, dime y te paso el link directo al APK
   `csd-app-2.57.0.apk` del bucket dev para instalarlo a mano (mismo resultado,
   solo cambia cómo llega el archivo al teléfono).
5. Confirma que instala **sin** el error "Aplicación no instalada" (si sale, casi
   siempre es que el teléfono se quedó sin espacio — revisa Ajustes › Almacenamiento
   antes de reintentar, no es un problema de firma).
6. Con 2.57.0 ya instalada y abierta, dale un vistazo rápido a lo nuevo de esta ronda:
   - **Inventario › Requisiciones** (bandeja de todas) y **Solicitudes › Mis
     requisiciones**, pestaña Activas: toca los chips **Fecha** y **Necesidad** —
     debe reordenar la lista y mostrar ▲ o ▼ según toques la misma otra vez.
   - **Tecnología › Dev notes**: abre una nota que tenga una imagen pegada desde la
     computadora (si tienes alguna) — debe verse la imagen, no un cuadro roto. Si la
     nota está en una carpeta (creada desde la web), debe verse "📁 Carpeta / Sub"
     arriba del contenido.
   - **Administración › Usuarios**: si tienes a mano un caso que antes daba error al
     crear/activar/resetear contraseña/fijar PIN/reenviar invitación, el mensaje
     debería ahora explicar el motivo real (no un genérico "Edge Function returned...").
7. Anota abajo qué tal fue (actualizó sin trabarse, algo se vio raro, algo lento).

## Si algo falla — cómo lo vemos sin que tengas que escribir nada técnico

Conecta el teléfono por USB a tu computadora y dime "falló, ahí está conectado" —
desde ahí se puede leer lo que pasó con `adb logcat` (lectura pasiva, no hace falta
que teclees ni toques nada más en la pantalla). También sirve una captura del error.

## Resultado

- Qué se probó: _pendiente_
- ¿Actualizó sin trabarse?: _pendiente_
- ¿Algo raro en pantalla angosta (390px)?: _pendiente_
- ¿Algo lento con datos reales?: _pendiente_
- Fecha: _pendiente_

OK: _pendiente — falta que Xaviel pruebe en el Samsung o dé su OK explícito de saltarla (ver arriba, van 4 rondas seguidas sin probar el updater en hardware real)._
