-- AO — publicar la app móvil 1.74.1 (rolling): listas desplegables en hoja modal
-- deslizable + destino "Almacén central" = Bodega Central directo. Solo app (código),
-- aditivo, reversible. NO toca version_minima (1.42.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.74.0') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.74.1')
 where plataforma = 'movil'
   and version in ('1.74.1', '1.74.0');

commit;

select sgc.version_publicada();
