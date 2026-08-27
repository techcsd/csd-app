-- «Un vehículo EN USO por chofer» — invariante a nivel de BD (cubre app Y web,
-- porque ambos inician usos por el MISMO camino: iniciar_uso_vehiculo, único
-- insertador de vehiculo_usos). Un chofer no puede tener 2+ vehículos "en uso" a
-- la vez: al abrir un uso nuevo se cierran sus usos activos anteriores.
--
-- Causa: iniciar_uso_vehiculo ya cierra el uso del OTRO tenedor del MISMO vehículo
-- (al recibir), pero NO cerraba los usos del PROPIO chofer en OTROS vehículos →
-- Polin quedó "en uso" de 2-3 vehículos. Esto desincronizaba el modelo "en uso"
-- y confundía el selector/hub. NO toca vehiculo_asignaciones (cero impacto en la
-- web: combustible/rutas/reportes que dependen de asignaciones siguen igual).

-- 1) Trigger: al insertar un uso ACTIVO, cierra los otros usos activos del mismo
--    chofer (mismo contexto es_prueba, para no mezclar prueba con real).
create or replace function sgc.tg_uso_unico_por_chofer()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if new.fin_at is null then
    update sgc.vehiculo_usos
       set fin_at = coalesce(new.inicio_at, now()),
           notas  = concat_ws(' · ', notas, 'Cerrado: el chofer pasó a otro vehículo')
     where usuario_id = new.usuario_id
       and fin_at is null
       and coalesce(es_prueba, false) = coalesce(new.es_prueba, false);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_uso_unico_por_chofer on sgc.vehiculo_usos;
create trigger trg_uso_unico_por_chofer
  before insert on sgc.vehiculo_usos
  for each row execute function sgc.tg_uso_unico_por_chofer();

-- 2) Limpieza de una vez: si un chofer ya tiene varios usos activos, deja SOLO el
--    más reciente (el que empezó de último) y cierra los demás (fantasmas).
with ranked as (
  select id,
         row_number() over (
           partition by usuario_id, coalesce(es_prueba, false)
           order by inicio_at desc nulls last, created_at desc nulls last
         ) as rn
  from sgc.vehiculo_usos
  where fin_at is null
)
update sgc.vehiculo_usos u
   set fin_at = now(),
       notas  = concat_ws(' · ', u.notas, 'Cerrado en limpieza: chofer con varios vehículos a la vez')
  from ranked r
 where r.id = u.id
   and r.rn > 1;
