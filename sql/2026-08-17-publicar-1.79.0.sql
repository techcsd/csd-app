-- Publicar (rolling) la versión 1.79.0 de la app móvil (PROMPT-18 FASE 2/3/5:
-- firma remota del despachante, sin-rol, login show/hide, QA de flota, grupos).
-- Flip de `publicada`; sin cambios de esquema. `version_minima` sigue en 1.70.0.
-- Rollback: update sgc.app_versiones set publicada=(version='1.78.0') where plataforma='movil';
begin;

update sgc.app_versiones set publicada = false
  where plataforma = 'movil' and publicada = true and version <> '1.79.0';

update sgc.app_versiones set publicada = true
  where plataforma = 'movil' and version = '1.79.0';

commit;
