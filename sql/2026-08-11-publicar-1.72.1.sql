-- AM6 — publicar la app móvil 1.72.1 (rolling): retira el origen "Otros" del conduce
-- sobre 1.72.0. Aditivo, reversible. NO toca version_minima (1.70.0).
-- Rollback: update sgc.app_versiones set publicada=(version='1.72.0') where plataforma='movil';
begin;

update sgc.app_versiones
   set publicada = (version = '1.72.1')
 where plataforma = 'movil'
   and version in ('1.72.1', '1.72.0');

commit;

select sgc.version_publicada();
