-- BK / PROMPT-37 — publicar la app móvil 2.14.0 (rolling). Marca 2.14.0 como la
-- versión PUBLICADA (publicada=true solo para ella, false para el resto). NO toca
-- `minima` (el floor forzado lo controla el admin): queda donde esté (hoy 2.13.0),
-- así 2.14.0 se ofrece como OPCIONAL y no se fuerza a nadie por publicar.
-- Rollback: update sgc.app_versiones set publicada=(version='2.13.0') where plataforma='movil';

update sgc.app_versiones
   set publicada = (version = '2.14.0')
 where plataforma = 'movil';
