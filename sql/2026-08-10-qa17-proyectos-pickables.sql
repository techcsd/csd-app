-- QA-17 (AJ15 / PROMPT-15) — Picker de obras para roles que la RLS de proyectos NO admite.
--
-- Problema: la RLS de SELECT de sgc.proyectos admite admin / módulo proyectos /
-- transporte / flota / responsable / miembro (proyecto_empleados). NO admite los
-- módulos `compras` ni `bitacora`. Los pickers de obra que leen `proyectos` DIRECTO
-- (solicitudes/pedir, compras-proyecto, la bitácora) devuelven [] en silencio para
-- esos roles → dropdown vacío y flujo muerto. Es la misma clase del bug ya arreglado
-- en inventario con `obras_con_bodega()`.
--
-- Fix: RPC security-definer que devuelve las obras elegibles (id, nombre,
-- responsable_nombre), filtrando `es_prueba` (salvo admin) y `activo`. No toca la RLS
-- de la web (aditivo). Los nombres de obra no son sensibles; el acceso se acota a
-- usuarios con un módulo operativo relevante o vínculo a la obra.

create or replace function sgc.proyectos_pickables()
returns table(id uuid, nombre text, responsable_nombre text)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select p.id, p.nombre::text, p.responsable_nombre::text
  from sgc.proyectos p
  where coalesce(p.activo, true)
    and (sgc.is_admin() or not coalesce(p.es_prueba, false))
    and (
      sgc.is_admin()
      or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('compras')
      or sgc.tiene_modulo('obra')      or sgc.tiene_modulo('bitacora')
      or sgc.tiene_modulo('inventario')or sgc.tiene_modulo('flota')
      or sgc.tiene_modulo('transporte')
      or p.responsable_id = auth.uid()
      or exists (
        select 1 from sgc.proyecto_empleados pe
        join sgc.empleados e on e.id = pe.empleado_id
        where pe.proyecto_id = p.id and e.usuario_id = auth.uid())
    )
  order by p.nombre;
$function$;

grant execute on function sgc.proyectos_pickables() to public;
grant execute on function sgc.proyectos_pickables() to authenticated;
grant execute on function sgc.proyectos_pickables() to service_role;
