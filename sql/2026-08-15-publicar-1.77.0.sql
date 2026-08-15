-- Publicar (rolling) la versión 1.77.0 de la app móvil (PROMPT-16 AR — Registro de Personal de obra).
-- Flip de `publicada`; sin cambios de esquema. `version_minima` sigue en 1.70.0.
-- Rollback: update sgc.app_versiones set publicada=(version='1.76.0') where plataforma='movil';
begin;

update sgc.app_versiones set publicada = false
  where plataforma = 'movil' and publicada = true and version <> '1.77.0';

update sgc.app_versiones set publicada = true
  where plataforma = 'movil' and version = '1.77.0';

commit;
