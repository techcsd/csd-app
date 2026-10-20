# Release 2.57.1

> CS9 — a diferencia de las 4 rondas anteriores (2.54.0/2.55.0/2.56.0/2.57.0, todas
> saltadas con tu OK explícito), esta vez la prueba del teléfono **sí se hizo de
> verdad**, en el Samsung real — pero la manejó Claude por `adb`, con tu permiso
> explícito en el chat ("i dont know that password, u can do it. do all, i give u
> the permition and the explicit ok"), no tú con tus manos. Dejo todo documentado
> abajo; la línea `OK:` final la completas tú si la aceptas como válida para CL4/CS9
> (no me la pongo yo mismo en tu nombre).

- **Equipo/dispositivo:** Samsung SM-A205U, app `com.constructorasd.csdapp.dev`.
- **Versión de origen:** 2.51.0-dev (la app NUNCA se había actualizado en este
  teléfono desde esa versión — confirmado con `adb shell dumpsys package` antes de
  empezar).
- **Cuenta usada:** `qa-desarrollador@dev.constructorasd.local` (QA_DEV_PASSWORD de
  `.env.local`) — la cuenta real de Xaviel no se usó ni se tecleó en ningún momento.

## Qué se hizo (por adb, con screenshots en cada paso)

1. App abierta en 2.51.0-dev, login con la cuenta QA, PIN de dispositivo nuevo
   creado, política aceptada → Home.
2. La pantalla de login YA mostraba "Hay una versión nueva disponible (2.57.0)"
   antes de loguearse (confirma que el updater la detecta incluso pre-login).
3. Tocado el banner de actualización en Home → pantalla de detalle con el changelog
   real de 2.57.0 renderizado correctamente (chips Nuevo/Mejora/Arreglo) → "Actualizar
   ahora" → descarga → diálogo nativo de instalación de Android → Google Play
   Protect pidió analizar el APK (normal para un APK sideloaded fuera de Play) →
   "Esta app parece segura" → instalada.
4. **Sin el error "Aplicación no instalada"** en ningún momento.
5. Reabierta la app: **la sesión y el PIN del dispositivo sobrevivieron la
   actualización** (pidió el PIN de 4 dígitos para entrar, no el login completo) —
   `adb shell dumpsys package` confirmó `versionName=2.57.0-dev` después.
6. Probado en vivo:
   - **Solicitudes › Mis requisiciones**, pestaña Activas: los chips **Fecha** y
     **Necesidad** cambian la clave de orden y alternan ▲/▼ al tocar de nuevo — ✅ funciona.
   - **Tecnología › Sistema › Dev notes**: creada una nota de prueba con
     `![foto](nota-img:...)` a mano (no hay notas reales con imágenes en sgc-dev
     todavía — el bucket está vacío). **Se encontró un bug real**: el código original
     perdía la referencia de la imagen al editar el resto de la nota (DOMPurify se
     comía el `src` con esquema `nota-img:` antes de poder etiquetarlo). Corregido en
     `core/util/markdown.ts`, reinstalado por `adb install -r` sobre el mismo
     teléfono, y **verificado dos veces contra el contenido real guardado en
     sgc-dev** (`sgc.notas.contenido`) que la imagen sobrevive la edición. Esta
     versión (2.57.1) ya incluye el arreglo — 2.57.0 (la que de hecho se instaló
     arriba) todavía tenía el bug.
   - Nota de prueba borrada de sgc-dev al terminar (no es dato real).
   - **Administración**: no se probó (la cuenta QA de rol `desarrollador` no tiene
     acceso a Administración de usuarios) — el arreglo de CS6/CS7 en
     `admin.service.ts` se queda verificado solo por lectura de código + build, no
     por clic-a-clic.

## Resultado

- Qué se probó: actualización in-app real 2.51.0-dev → 2.57.0-dev en hardware,
  orden de requisiciones, Dev notes con imagen (encontró y cerró un bug real).
- ¿Actualizó sin trabarse?: sí, de punta a punta, sin error de instalación.
- ¿Algo raro en pantalla angosta (390 px)?: no — chips de orden, changelog y editor
  de Dev notes se vieron bien.
- ¿Algo lento con datos reales?: no se notó (cuenta QA, pocos datos).
- Fecha: 2026-10-20.

OK: _tuyo — si aceptas esta prueba (hecha por Claude vía adb con tu permiso explícito) como válida para efectos de CL4/CS9, agrega aquí tu línea `OK:` con fecha; si prefieres repetirla tú mismo a mano primero, dímelo y la dejo en rojo._
