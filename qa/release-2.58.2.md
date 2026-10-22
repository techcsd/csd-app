# Release 2.58.2

- **Equipo/dispositivo:** <pendiente — Samsung de Xaviel>.
- **Versión de origen:** 2.57.1 (la publicada en prod hoy; 2.58.0 y 2.58.1 solo
  llegaron a dev — la actualización in-app real se prueba desde 2.57.1).

## Qué probar

### 1. CV1 — Compa prepara una echada
1. Entra a Compa con un usuario que tenga el módulo Flota (idealmente el de
   Felix, vía "Entrar como", o un usuario propio con Flota).
2. Escríbele: **"Registra una echada: [tu vehículo], 12 galones, 3360 pesos"**.
3. Confirma que Compa responde con la tarjeta **"Echada preparada"** (vehículo,
   galones, monto, fecha) + el aviso ámbar **"Faltan: foto del recibo, foto del
   tablero y lectura del odómetro"** + un solo botón naranja **"Abrir
   formulario"** (sin "Confirmar").
4. Toca **"Abrir formulario"**: debe aterrizar en Transporte › Combustible con
   el vehículo correcto, el banner **"Compa llenó estos datos…"**, galones y
   monto ya puestos con el chip **"Compa"**, y el odómetro **vacío** (nunca
   inventado).
5. Intenta guardar sin fotos: debe seguir **bloqueado**. Toma las 2 fotos +
   escribe el odómetro y confirma que **"Guardar echada"** se habilita y la
   echada se registra igual que una normal (mismos topes de galones/precio,
   antiduplicado, etc.).
6. Edita el campo de galones a mano: el chip "Compa" de ese campo debe
   **desaparecer** (los demás se quedan).
7. Repite el paso 2-4 en **modo avión** (sin señal): Compa necesita conexión
   para preparar la echada (debe avisarlo con claridad); con el formulario ya
   abierto y los datos puestos, completa fotos+odómetro y guarda SIN señal —
   debe quedar en el outbox y sincronizar sola al volver la señal, igual que
   cualquier echada.
8. Si ya tenías una echada a medias sin terminar (borrador) para el MISMO
   vehículo antes de pedirle esto a Compa: al volver debe aparecer el aviso de
   borrador de siempre, y un aviso aparte de que "Compa había preparado otra
   echada; no se aplicó" (los datos de Compa NO deben pisar el borrador).

### 2. CV2/CV3 — Dev notes (paridad, nada que probar en la app)
La app sigue siendo de solo lectura para grupos — no hay nada nuevo que tocar
aquí. Si quieres confirmarlo: crea/renombra/mueve un grupo o una nota en la web
(Dev notes) y revisa que la ruta "Carpeta / Sub" se vea bien en la app (lista y
lector) — verificado ya en dev por la sesión (ver `PARIDAD.md § CV`), esto es
solo una comprobación de más si quieres verla con tus propios ojos.

## Resultado

<pendiente — Xaviel>

## Fecha

<pendiente>

<!-- La línea "OK:" (con fecha) la agrega Xaviel después de probar en el teléfono. -->
