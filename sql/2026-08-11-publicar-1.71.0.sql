-- PROMPT-4 AL — publicar (rolling) la versión móvil 1.71.0 a los usuarios.
-- Aditivo/idempotente. minima se mantiene (1.42.0). Registrar en historial ya se
-- hizo con npm run apk; esto es el paso de PUBLICAR (flip publicada).
begin;
update sgc.app_versiones set publicada = true  where plataforma = 'movil' and version = '1.71.0';
update sgc.app_versiones set publicada = false where plataforma = 'movil' and version <> '1.71.0' and publicada = true;
commit;
