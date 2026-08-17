-- Publicar (rolling) la versión 1.78.0 de la app móvil (AS1 — tracking en tiempo
-- real desacoplado de rutas). Flip de `publicada`; sin cambios de esquema.
-- `version_minima` sigue en 1.70.0.
-- Rollback: update sgc.app_versiones set publicada=(version='1.77.1') where plataforma='movil';
begin;

update sgc.app_versiones set publicada = false
  where plataforma = 'movil' and publicada = true and version <> '1.78.0';

update sgc.app_versiones set publicada = true
  where plataforma = 'movil' and version = '1.78.0';

commit;
