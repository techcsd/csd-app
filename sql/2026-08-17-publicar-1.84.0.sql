-- Publicar (rolling) 1.84.0 (AS21 — importar cronograma desde Excel). Flip publicada; sin esquema.
-- Rollback: update sgc.app_versiones set publicada=(version='1.83.0') where plataforma='movil';
begin;
update sgc.app_versiones set publicada=false where plataforma='movil' and publicada=true and version<>'1.84.0';
update sgc.app_versiones set publicada=true where plataforma='movil' and version='1.84.0';
commit;
