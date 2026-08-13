-- AO — publicar la app móvil 1.74.0 (rolling): control de existencias + bloqueo al
-- crear conduces, corrección de conduces trabados, compartir conduce en PDF, y home
-- responsive + aviso de WebView. Solo app (código), aditivo, reversible. NO toca
-- version_minima (1.42.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.73.1') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.74.0')
 where plataforma = 'movil'
   and version in ('1.74.0', '1.73.1');

commit;

select sgc.version_publicada();
