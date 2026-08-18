-- 1.86.1 — retoque visual (año del vehículo). Publicar como vigente (rolling).
-- Solo mueve `publicada`; no toca `version_minima`. Reversible.
-- Rollback: update sgc.app_versiones set publicada=(version='1.86.0') where plataforma='movil';
update sgc.app_versiones
set publicada = (version = '1.86.1')
where plataforma = 'movil';

select version, publicada from sgc.app_versiones
where plataforma = 'movil' and (publicada or version in ('1.86.0','1.86.1'))
order by version desc;
