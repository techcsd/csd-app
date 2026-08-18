-- PROMPT-22 (AU) — publicar 1.87.1 (móvil): sugerencias de material sin acentos.
-- Marca 1.87.1 como publicada (rolling) y desmarca las demás (1.87.0 → false).
-- No toca version_minima (sigue 1.70.0). Reversible: publicar de nuevo la anterior.
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.87.1')
 where plataforma = 'movil';

select version, publicada, minima
  from sgc.app_versiones
 where plataforma = 'movil'
 order by created_at desc
 limit 5;
