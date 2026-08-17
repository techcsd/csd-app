-- Publicar (rolling) 1.83.0 (AS24 — QA del módulo Proyectos en la app). Flip publicada; sin esquema.
-- Rollback: update sgc.app_versiones set publicada=(version='1.82.0') where plataforma='movil';
begin;
update sgc.app_versiones set publicada=false where plataforma='movil' and publicada=true and version<>'1.83.0';
update sgc.app_versiones set publicada=true where plataforma='movil' and version='1.83.0';
commit;
