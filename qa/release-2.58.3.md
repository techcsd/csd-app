# Release 2.58.3

- **Equipo/dispositivo:** <pendiente — Samsung de Xaviel>.
- **Versión de origen:** la que esté publicada en **prod** al momento de probar
  (confirma en Perfil/Ajustes antes de actualizar — no se verificó cuál es
  exactamente desde esta sesión).

## Qué probar (ronda CW)

### 1. CW6/CW7 — chofer privado no ve conduces/rutas de empresa
1. "Entrar como" un chofer con **solo** el rol Chofer privado (sin
   Transportista) — p. ej. Carlos o Dallin si quieres reproducir su caso real.
2. En el hub de Transporte: confirma que aparece un aviso discreto arriba
   ("Tu rol (chofer privado) no usa conduces ni rutas. Si debes hacerlo,
   pídelo a Central.") y que NO hay mosaicos de Rutas ni Conduce.
3. Prueba entrar por enlace directo (escribe la URL a mano o pide que alguien
   te la mande) a algo como `/transporte/conduces-hub` o
   `/transporte/rutas/crear`: antes se veía un formulario que luego fallaba
   sin explicar; ahora debe mandarte a una pantalla con el mismo texto fijo de
   arriba, no un formulario.
4. Confirma que SÍ puede seguir usando su vehículo propio: Uso de vehículo,
   Registrar combustible, Inspección, Mantenimientos — estas NO deben verse
   afectadas.

### 2. CW1/CW2 — conduce que nunca se envió (el caso de Carlos)
Esto es difícil de reproducir en vivo sin un conduce ya atascado real. Si
tienes uno (o lo armas a propósito sin señal con un usuario que no debería
poder crear conduces): al abrir ese conduce desde su ficha, en vez de "No
pudimos abrir el conduce" sin salida, ahora debe verse un aviso claro
("Este conduce no se pudo enviar... nunca llegó a registrarse en el
servidor") con dos botones: **Reintentar envío** y **Descartar**. Confirma que
"Descartar" sí lo hace desaparecer de la lista sin generar un error nuevo.

### 3. CW5 — lectura de foto de echada sin señal
Pon el teléfono en modo avión, inicia una echada, toma la foto del recibo:
debe avisar claramente que necesita conexión para leerla sola (y NO un error
genérico), dejándote llenar los datos a mano sin perder la foto. Con señal, la
lectura automática de siempre sigue igual (galones, monto, estación, N° de
recibo, producto — sin cambios, ya estaba a la par con la web).

### 4. CW3/CW4 — solo verificación, nada que probar en la app
Dev notes y el reporte de rendimiento por vehículo son de la web; la app no
cambió ahí. Si quieres confirmarlo con tus ojos: mueve una nota a "Sin grupo"
en la web (nuevo en esta ronda del padre) y revisa que la app la siga
mostrando bien en modo lectura.

## Resultado

<pendiente>

## Fecha

<pendiente>
