-- PROMPT-24 (AV) — publicar 1.88.1 (móvil): patch con map-matching (la trayectoria
-- sigue las calles). Marca 1.88.1 como publicada y desmarca las demás (1.88.0 →
-- false). No toca version_minima (sigue 1.70.0). Reversible.
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.88.1')
 where plataforma = 'movil';

select version, publicada, minima
  from sgc.app_versiones
 where plataforma = 'movil'
 order by created_at desc
 limit 5;
