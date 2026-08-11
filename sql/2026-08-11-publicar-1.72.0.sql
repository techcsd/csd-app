-- PROMPT-6 (AM) — publicar la app móvil 1.72.0 (rolling). Aditivo, reversible.
-- Marca 1.72.0 como la versión publicada y desmarca la anterior (1.71.0). NO toca
-- version_minima (sigue en su valor actual → nadie queda bloqueado por este flip).
-- Rollback: update sgc.app_versiones set publicada=(version='1.71.0')
--           where plataforma='movil'; (y revertir el commit para el PWA).
begin;

update sgc.app_versiones
   set publicada = (version = '1.72.0')
 where plataforma = 'movil'
   and version in ('1.72.0', '1.71.0');

commit;

-- Verificación.
select sgc.version_publicada();
