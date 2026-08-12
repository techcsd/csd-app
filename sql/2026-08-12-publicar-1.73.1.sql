-- AN — publicar la app móvil 1.73.1 (rolling): Bodega Central seleccionable al
-- crear rutas + arreglos visuales (rojo de peligro/obligatorio, botones aplastados).
-- Solo código, aditivo, reversible. NO toca version_minima (1.42.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.73.0') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.73.1')
 where plataforma = 'movil'
   and version in ('1.73.1', '1.73.0');

commit;

select sgc.version_publicada();
