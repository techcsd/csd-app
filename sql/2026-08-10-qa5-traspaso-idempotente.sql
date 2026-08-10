-- QA-5 (AJ15 / PROMPT-15) — Idempotencia del traspaso de vehículo.
--
-- Problema: sgc.traspasar_vehiculo NO recibía un UUID de cliente, así que un
-- reintento del outbox (respuesta HTTP perdida por mala señal, o fallo transitorio
-- posterior en audio_notas.commit) re-ejecutaba TODO: reasignación, avance de
-- odómetro, traspaso de llave, notificación y una NUEVA acta → acta + km duplicados.
-- Era el ÚNICO handler de escritura sin id idempotente.
--
-- Fix (aditivo, retrocompatible): la tabla de actas gana una columna `client_id`
-- (el UUID que el outbox ya acuña) con índice único parcial; la función gana un
-- parámetro opcional `p_id uuid` al FINAL. Si ese client_id ya produjo un acta, la
-- función la devuelve SIN re-ejecutar ningún efecto secundario. Los callers viejos
-- (web SGC + versiones de app en campo ≥1.42 que no mandan p_id) siguen igual: p_id
-- llega NULL → comportamiento idéntico al anterior.
--
-- Estrategia de despliegue: se crea el nuevo overload de 9 args ANTES de borrar el
-- viejo de 8, para que la función NUNCA quede ausente durante la migración; al
-- terminar solo queda una función (sin ambigüedad de PostgREST para los clientes
-- que omiten p_llave1_portador). Se re-otorgan los grants exactos originales.

-- 1) Columna + índice único parcial (dedup por client uuid).
alter table sgc.vehiculo_traspaso_actas
  add column if not exists client_id uuid;

create unique index if not exists ux_vehiculo_traspaso_actas_client
  on sgc.vehiculo_traspaso_actas (client_id)
  where client_id is not null;

-- 2) Nuevo overload (9 args: +p_id). Cuerpo idéntico al de prod salvo la guarda de
--    idempotencia al inicio y el client_id en el insert del acta.
create or replace function sgc.traspasar_vehiculo(
  p_vehiculo_id uuid,
  p_km integer default null,
  p_condiciones jsonb default null,
  p_fotos text[] default '{}'::text[],
  p_llave1_ubicacion text default null,
  p_llave1_portador uuid default null,
  p_llave1_detalle text default null,
  p_notas text default null,
  p_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();   -- B (nuevo asignado)
  v_a   uuid;                 -- A (asignado anterior)
  v_placa text;
  v_es_prueba boolean := false;
  v_acta uuid;
begin
  if v_uid is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('flota')
          or exists (select 1 from sgc.conductores c where c.usuario_id = v_uid)) then
    raise exception 'Sin permiso para recibir vehículos';
  end if;
  if not exists (select 1 from sgc.vehiculos where id = p_vehiculo_id) then
    raise exception 'Vehículo no encontrado';
  end if;

  -- QA-5 — idempotencia: si esta captura (client uuid) ya creó un acta, devolverla
  -- sin re-ejecutar reasignación/odómetro/llaves/notificación. El outbox drena en
  -- serie, así que este chequeo cubre el reintento real (no hay carrera concurrente).
  if p_id is not null then
    select id into v_acta from sgc.vehiculo_traspaso_actas where client_id = p_id;
    if v_acta is not null then return v_acta; end if;
  end if;

  select placa, coalesce(es_prueba,false) into v_placa, v_es_prueba from sgc.vehiculos where id = p_vehiculo_id;

  -- Asignado anterior (A): asignación activa o responsable legacy.
  select coalesce(a.usuario_id, c.usuario_id)
    into v_a
    from sgc.vehiculo_asignaciones a
    left join sgc.conductores c on c.id = a.conductor_id
   where a.vehiculo_id = p_vehiculo_id and a.activa
   order by a.desde desc nulls last
   limit 1;
  if v_a is null then
    select responsable_id into v_a from sgc.vehiculos where id = p_vehiculo_id;
  end if;

  -- Reasignar: retira las asignaciones activas y crea la de B.
  update sgc.vehiculo_asignaciones set activa = false, hasta = now()
   where vehiculo_id = p_vehiculo_id and activa;
  insert into sgc.vehiculo_asignaciones (vehiculo_id, usuario_id, desde, activa, origen, notas)
  values (p_vehiculo_id, v_uid, now(), true, 'auto', p_notas);
  update sgc.vehiculos set responsable_id = v_uid where id = p_vehiculo_id;

  -- AH12 — Cerrar la custodia abierta del tenedor anterior: el traspaso la supera.
  -- Sin esto, vehiculos_asignados() seguía mostrando al anterior por 'custodia'
  -- (la fuente más fuerte) ademas del nuevo por 'asignacion'.
  update sgc.vehiculo_entregas
     set estado = 'cerrada'
   where vehiculo_id = p_vehiculo_id
     and tipo = 'recepcion' and estado = 'abierta'
     and conductor_usuario_id is distinct from v_uid;

  if p_km is not null then perform sgc.avanzar_odometro(p_vehiculo_id, p_km); end if;

  -- Llave 1: registrar su disposición si se indicó (traspaso autorizado).
  if p_llave1_ubicacion in ('chofer_asignado','oficina_central','otro') then
    insert into sgc.vehiculo_llaves (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, actualizado_por, updated_at)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, v_uid, now())
    on conflict (vehiculo_id, numero) do update
      set ubicacion_tipo = excluded.ubicacion_tipo, portador_usuario_id = excluded.portador_usuario_id,
          ubicacion_detalle = excluded.ubicacion_detalle, actualizado_por = v_uid, updated_at = now();
    insert into sgc.vehiculo_llave_traspasos (vehiculo_id, numero, ubicacion_tipo, portador_usuario_id, ubicacion_detalle, nota, registrado_por)
    values (p_vehiculo_id, 1, p_llave1_ubicacion,
            case when p_llave1_ubicacion='chofer_asignado' then coalesce(p_llave1_portador, v_uid) else null end,
            case when p_llave1_ubicacion='otro' then p_llave1_detalle else null end, 'Traspaso de vehículo', v_uid);
  end if;

  -- Acta.
  insert into sgc.vehiculo_traspaso_actas (
    vehiculo_id, de_usuario_id, a_usuario_id, km, condiciones, fotos, llave1_ubicacion_tipo, notas, es_prueba, client_id
  ) values (
    p_vehiculo_id, v_a, v_uid, p_km, p_condiciones, coalesce(p_fotos,'{}'), p_llave1_ubicacion, p_notas, v_es_prueba, p_id
  ) returning id into v_acta;

  -- Notificar a A (in-app + push). A NO tiene que aceptar; sólo se le avisa.
  if v_a is not null and v_a <> v_uid then
    perform sgc.notificar(
      v_a, 'info', 'Te recibieron un vehículo',
      format('%s recibió el vehículo %s. La responsabilidad pasó a esa persona.',
             coalesce((select nombre from sgc.usuarios where id = v_uid), 'Otro usuario'),
             coalesce(v_placa, '')),
      '/flota/vehiculos/' || p_vehiculo_id::text
    );
  end if;

  return v_acta;
end;
$function$;

-- 3) Retirar el overload viejo de 8 args (ya reemplazado por el de 9). Tras esto
--    queda una sola función; los clientes que omiten p_llave1_portador/p_id resuelven
--    sin ambigüedad.
drop function if exists sgc.traspasar_vehiculo(uuid,integer,jsonb,text[],text,uuid,text,text);

-- 4) Re-otorgar los grants originales (=X para PUBLIC + authenticated + service_role).
grant execute on function sgc.traspasar_vehiculo(uuid,integer,jsonb,text[],text,uuid,text,text,uuid) to public;
grant execute on function sgc.traspasar_vehiculo(uuid,integer,jsonb,text[],text,uuid,text,text,uuid) to authenticated;
grant execute on function sgc.traspasar_vehiculo(uuid,integer,jsonb,text[],text,uuid,text,text,uuid) to service_role;
