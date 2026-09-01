-- Publica la app móvil 2.9.0 (rolling a todos). La mínima NO se toca (dominio
-- admin de Xaviel). Rollback: set publicada=(version='2.8.1') where plataforma='movil'.
begin;
set local search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '2.9.0')
 where plataforma = 'movil';

commit;
