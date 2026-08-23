-- Publicar 1.96.2 (móvil) rolling. Tile "Crear ruta" en Ingeniería + arreglo menú Admin (RRHH).
-- version_minima intacta (1.96.2 NUNCA es mínima forzada).
set search_path = sgc, public;
update sgc.app_versiones set publicada = (version='1.96.2'), minima = false
 where plataforma='movil' and version='1.96.2';
update sgc.app_versiones set publicada = false
 where plataforma='movil' and version <> '1.96.2';
