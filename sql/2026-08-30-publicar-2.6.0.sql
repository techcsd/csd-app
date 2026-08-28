-- Rolling release: publicar la app móvil 2.6.0 a TODOS (ronda BC / PROMPT-22).
-- publicada=true solo para 2.6.0; minima INTACTA (1.96.4 sigue como mínimo forzado).
-- Rollback: update sgc.app_versiones set publicada=(version='2.5.0') where plataforma='movil';
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '2.6.0')
 where plataforma = 'movil';
