-- PROMPT-20 (QA en device) — el pack de stickers del sistema quedó con el nombre
-- mal codificado ("B�sico") en el seed de PROMPT-19; se veía roto en web y app.
-- Corrección de datos (idempotente). Espejar en SGC (repo padre).
update sgc.sticker_packs
set nombre = 'Básico'
where es_sistema and nombre <> 'Básico';

-- Verificación
select id, nombre, es_sistema from sgc.sticker_packs where es_sistema;
