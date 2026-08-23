-- Publicar 1.96.1 (móvil) rolling. Arreglo del menú de Producción de Obra (no 403)
-- + accesos de roles (ingeniero_campo→obra, guarda_almacen→flota).
-- version_minima se mantiene intacta (1.96.1 NUNCA es mínima forzada).
set search_path = sgc, public;

update sgc.app_versiones
   set publicada = (version = '1.96.1'),
       minima = false
 where plataforma = 'movil' and version = '1.96.1';

update sgc.app_versiones
   set publicada = false
 where plataforma = 'movil' and version <> '1.96.1';

select (sgc.version_publicada()->>'version') as publicada;
select version, publicada, minima from sgc.app_versiones where plataforma='movil' and version in ('1.96.1','1.96.0','1.92.0') order by version desc;
