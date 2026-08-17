-- Publicar (rolling) la versión 1.81.0 (FASE 4: ubicación de almacenes + ajuste de stock + conteos unificados).
-- Flip de `publicada`; sin cambios de esquema. version_minima sigue en 1.70.0.
-- Rollback: update sgc.app_versiones set publicada=(version='1.80.0') where plataforma='movil';
begin;
update sgc.app_versiones set publicada = false where plataforma='movil' and publicada=true and version <> '1.81.0';
update sgc.app_versiones set publicada = true where plataforma='movil' and version='1.81.0';
commit;
