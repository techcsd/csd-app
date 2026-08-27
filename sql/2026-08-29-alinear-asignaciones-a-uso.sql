-- Alineación DE UNA VEZ de vehiculo_asignaciones a la realidad (quién usa qué AHORA,
-- ya limpio con «un uso por chofer»). NO es un auto-sync (eso rompería la web); es
-- una corrección puntual de datos viejos: Manolo↔Polin estaban cruzados, Misael y
-- Edward desalineados. Sigue el patrón del traspaso: desactivar la vieja → insertar
-- la nueva (una activa por vehículo) → fijar vehiculos.responsable_id. Reversible:
-- las filas viejas quedan con activa=false + hasta=now() (se pueden reactivar).

-- 1) Desactivar asignaciones CONTRADICHAS por el uso real: el usuario usa OTRO
--    vehículo, o su vehículo asignado lo usa OTRO. Las que ya coinciden se quedan.
with usos as (
  select distinct on (usuario_id) usuario_id, vehiculo_id
  from sgc.vehiculo_usos where fin_at is null
  order by usuario_id, inicio_at desc nulls last
)
update sgc.vehiculo_asignaciones a
   set activa = false,
       hasta  = now(),
       notas  = concat_ws(' · ', a.notas, 'Cerrada: alineación a vehículo en uso (2026-08-29)')
 where a.activa
   and ( exists (select 1 from usos u where u.usuario_id = a.usuario_id and u.vehiculo_id <> a.vehiculo_id)
      or exists (select 1 from usos u where u.vehiculo_id = a.vehiculo_id and u.usuario_id <> a.usuario_id) );

-- 2) Insertar la asignación correcta (chofer ↔ vehículo que usa) si no existe activa.
with usos as (
  select distinct on (usuario_id) usuario_id, vehiculo_id
  from sgc.vehiculo_usos where fin_at is null
  order by usuario_id, inicio_at desc nulls last
)
insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, activa, desde, origen, notas)
select u.vehiculo_id, u.usuario_id, true, now(), 'auto', 'Alineada al vehículo en uso (2026-08-29)'
from usos u
where u.usuario_id is not null
  and not exists (
    select 1 from sgc.vehiculo_asignaciones a
     where a.vehiculo_id = u.vehiculo_id and a.usuario_id = u.usuario_id and a.activa
  );

-- 3) responsable_id del vehículo = quien lo usa (coherente con el traspaso).
with usos as (
  select distinct on (usuario_id) usuario_id, vehiculo_id
  from sgc.vehiculo_usos where fin_at is null
  order by usuario_id, inicio_at desc nulls last
)
update sgc.vehiculos v
   set responsable_id = u.usuario_id
  from usos u
 where v.id = u.vehiculo_id
   and v.responsable_id is distinct from u.usuario_id;
