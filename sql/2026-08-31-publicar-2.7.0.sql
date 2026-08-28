-- BD — publicar la app móvil 2.7.0 (rolling a todos). Solo toca `publicada`;
-- NO toca `minima` (queda como estaba). Rollback: poner publicada en 2.6.0.
begin;

update sgc.app_versiones
set publicada = (version = '2.7.0')
where plataforma = 'movil';

commit;
