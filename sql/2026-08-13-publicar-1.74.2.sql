-- AO1 — publicar la app móvil 1.74.2 (rolling): todos los mapas de la app usan
-- Google Maps (location-picker migrado; seguimiento ya lo usaba). Solo app (código),
-- aditivo, reversible. NO toca version_minima (1.42.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.74.1') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.74.2')
 where plataforma = 'movil'
   and version in ('1.74.2', '1.74.1');

commit;

select sgc.version_publicada() as publicada;
