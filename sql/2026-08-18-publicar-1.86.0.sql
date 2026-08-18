-- PROMPT-20 (1.86.0) — publicar como versión vigente (rolling) para móvil.
-- Solo mueve el flag `publicada`; no toca `version_minima` (sigue igual). Aditivo/reversible.
-- Rollback: update sgc.app_versiones set publicada=(version='1.85.0') where plataforma='movil';
update sgc.app_versiones
set publicada = (version = '1.86.0')
where plataforma = 'movil';

-- Verificación
select version, publicada, minima
from sgc.app_versiones
where plataforma = 'movil' and (publicada or version in ('1.85.0','1.86.0'))
order by version desc;
