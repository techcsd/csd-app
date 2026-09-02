-- Publica la app móvil 2.10.0 (rolling a todos los Android). NO toca `minima`
-- (dominio admin de Xaviel). Rollback: set publicada=(version='2.9.0').
-- Apply: node scripts/apply-migration.mjs sql/2026-09-02-publicar-2.10.0.sql
begin;
update sgc.app_versiones
   set publicada = (version = '2.10.0')
 where plataforma = 'movil';
commit;
