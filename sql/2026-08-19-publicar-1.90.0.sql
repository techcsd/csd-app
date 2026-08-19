-- PROMPT-28 (AX) — publicar 1.90.0 (móvil) como versión publicada (rolling).
-- Marca 1.90.0 como publicada y desmarca las demás. NO fuerza actualización:
-- version_minima se mantiene en 1.70.0 (la fila 1.90.0 queda minima=false — blindaje;
-- en 1.88.1 la fila salió con minima=true y forzó update bloqueante a todos).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.90.0'),
       minima = false               -- blindaje: 1.90.0 nunca es mínima forzada
 where plataforma = 'movil' and version = '1.90.0';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.90.0';

-- Verificación: publicada=1.90.0 y version_minima debe seguir en 1.70.0.
select sgc.version_publicada() as v;
