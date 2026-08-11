-- PROMPT-8 AN — publicar la app móvil 1.73.0 (rolling): grupos de mensajes tipo
-- WhatsApp, permisos por submódulo en Flota/Inventario, datos de referencia visibles
-- para roles restringidos. Aditivo, reversible. NO toca version_minima (1.42.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.72.1') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.73.0')
 where plataforma = 'movil'
   and version in ('1.73.0', '1.72.1');

commit;

select sgc.version_publicada();
