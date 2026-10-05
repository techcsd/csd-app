-- CG13 (hueco del hijo → lo aplica el PADRE, regla 18/19) — subir el límite de tamaño
-- del bucket `vehiculos` a 20 MB para los adjuntos de mantenimiento (PDF del taller).
--
-- Contexto: la nota #137 pide poder subir el PDF del taller; la app (CSD App 2.42.0) ya
-- lo encola a `mantenimiento_adjuntos` (bucket `vehiculos`). Pero el bucket tiene
-- `file_size_limit = 15 MB`, así que la app valida 15 MB. La spec de CG13 pedía 20 MB.
-- Este cambio lo sube a 20 MB; después la app puede subir su tope a 20 (una línea).
--
-- `allowed_mime_types` ya es NULL (acepta cualquier tipo, incluido application/pdf) → no
-- se toca. Idempotente.

update storage.buckets
   set file_size_limit = 20971520   -- 20 * 1024 * 1024
 where id = 'vehiculos';

-- Verificación:
--   select id, file_size_limit, allowed_mime_types from storage.buckets where id = 'vehiculos';
