-- Publicar app MÓVIL 2.11.0 (rolling). Marca 2.11.0 como la versión publicada (la que
-- la app ofrece para actualizar) y desmarca las demás. Deja `minima` INTACTA: NO fuerza
-- a nadie a actualizar (rollout suave). Rollback: repetir con '2.10.0'.
update sgc.app_versiones
   set publicada = (version = '2.11.0')
 where plataforma = 'movil';
