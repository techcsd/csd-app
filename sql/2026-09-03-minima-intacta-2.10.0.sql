-- Corrección: la `minima` (versión que FUERZA a actualizar) debe quedar en 2.10.0 —
-- el rollout de 2.12.0 es SUAVE (rolling), nadie forzado. Al registrar 2.12.0 quedó
-- por error minima=true en 2.12.0 (habría forzado a TODOS a actualizar ya). Esto la
-- devuelve a 2.10.0 (y desmarca cualquier otra). `publicada` sigue en 2.12.0.
-- Rollback improbable: set minima=(version='<otra>').
update sgc.app_versiones
   set minima = (version = '2.10.0')
 where plataforma = 'movil';
