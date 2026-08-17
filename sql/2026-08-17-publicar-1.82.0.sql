-- Publicar (rolling) 1.82.0 (AS14 — gastos directos del proyecto). Flip publicada; sin esquema.
-- Rollback: update sgc.app_versiones set publicada=(version='1.81.0') where plataforma='movil';
begin;
update sgc.app_versiones set publicada=false where plataforma='movil' and publicada=true and version<>'1.82.0';
update sgc.app_versiones set publicada=true where plataforma='movil' and version='1.82.0';
commit;
