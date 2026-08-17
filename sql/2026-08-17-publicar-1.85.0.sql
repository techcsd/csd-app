-- Publicar (rolling) 1.85.0 (AS23 — filtro de proyectos por zona). Flip publicada; sin esquema.
-- Rollback: update sgc.app_versiones set publicada=(version='1.84.0') where plataforma='movil';
begin;
update sgc.app_versiones set publicada=false where plataforma='movil' and publicada=true and version<>'1.85.0';
update sgc.app_versiones set publicada=true where plataforma='movil' and version='1.85.0';
commit;
