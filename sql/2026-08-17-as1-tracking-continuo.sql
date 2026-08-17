-- =============================================================================
-- AS1 / PROMPT-18 FASE 1 — Tracking en tiempo real: desacople de rutas + tuning
-- =============================================================================
-- Contexto (diagnóstico con evidencia de prod):
--   * `chofer_ultima_posicion` mostraba posiciones de HACE DÍAS (POLIN 15h, FELIX
--     2d, Misael 3d, Papo 6d). El 100% de las filas de `gps_ingesta_log` traían
--     `ruta_id` → los puntos SOLO se capturan durante una "ruta activa" formal.
--     El chofer que no corre una ruta formal no reporta nada → "dura días para
--     actualizar". La captura se desacopla en el CLIENTE (tracking continuo para
--     quien comparte ubicación). El backend YA acepta puntos sin ruta y YA gatea
--     por `sgc.comparte_ubicacion()`; `chofer_ultima_posicion` YA está en la
--     publicación realtime. Es decir: el backend estaba listo, el cliente no.
--   * Filtro de precisión demasiado estricto: un lote real trajo recibidos=40,
--     insertados=1, desc_precision=37 (y varios lotes con insertados=0 por salto).
--     Los teléfonos de gama baja dentro de un camión reportan 100–165 m de
--     precisión con frecuencia → se descartaban puntos buenos y la última posición
--     no se refrescaba. Se sube `gps_precision_max_m` 100 → 200 (dato, reversible).
--
-- Todo ADITIVO y RETROCOMPATIBLE. Fechado. Espejar a SGC.
-- =============================================================================

-- 1) Tuning de ingesta (evidencia: desc_precision masivo). Solo DATOS, reversible.
update sgc.parametros set valor = '200' where clave = 'gps_precision_max_m';

-- Cadencia del cliente, server-tunable (aditivo; si ya existen, no-op).
insert into sgc.parametros (clave, valor)
values ('gps_distance_filter_m', '25'), ('gps_flush_seg', '45'),
       ('tracking_activo_min', '15')  -- ventana para considerar a alguien "en línea"
on conflict (clave) do nothing;

-- 2) mi_config_tracking() — el cliente pregunta si DEBE rastrear (continuo) y con
--    qué cadencia. Reemplaza la heurística de "solo en ruta" por una decisión de
--    servidor basada en `comparte_ubicacion` (rol chofer_transportista o el
--    override por usuario en usuario_flags). Grant a authenticated.
create or replace function sgc.mi_config_tracking()
returns table (
  comparte        boolean,
  distancia_m     integer,
  flush_seg       integer,
  precision_max_m integer
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  select
    sgc.comparte_ubicacion(auth.uid()) as comparte,
    coalesce((select valor from sgc.parametros where clave='gps_distance_filter_m'),'25')::int,
    coalesce((select valor from sgc.parametros where clave='gps_flush_seg'),'45')::int,
    coalesce((select valor from sgc.parametros where clave='gps_precision_max_m'),'200')::int
$$;

grant execute on function sgc.mi_config_tracking() to authenticated;

-- 3) AO6 (cierre) — Seguimiento del jefe de flota incluye a quien comparte
--    ubicación aunque NO sea chofer_transportista (Eduardo pidió rastrear a
--    Misael). `choferes_estado()` se deja intacto (lo usa la web); esto es un
--    COMPANION aditivo que el cliente une. Devuelve la MISMA forma para poder
--    concatenar. estado = 'activo' si tiene fix reciente, si no 'inactivo'.
--    Solo lo pueden leer flota-elevado (mismo gate que Seguimiento).
create or replace function sgc.otros_rastreados()
returns table (
  usuario_id      uuid,
  conductor_id    uuid,
  nombre          text,
  estado          text,
  otros_texto     text,
  almuerzo_inicio timestamptz,
  desde           timestamptz,
  updated_at      timestamptz
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
  with ventana as (
    select coalesce((select valor from sgc.parametros where clave='tracking_activo_min'),'15')::int as min
  )
  select
    u.id as usuario_id,
    null::uuid as conductor_id,
    u.nombre,
    case when up.capturado_en is not null
              and up.capturado_en > now() - make_interval(mins => (select min from ventana))
         then 'activo' else 'inactivo' end as estado,
    null::text as otros_texto,
    null::timestamptz as almuerzo_inicio,
    up.capturado_en as desde,
    up.updated_at
  from sgc.usuarios u
  join sgc.chofer_ultima_posicion up on up.usuario_id = u.id
  where sgc.es_flota_elevado()                 -- gate: solo supervisores
    and sgc.comparte_ubicacion(u.id)           -- comparte ubicación (rol u override)
    and not exists (                            -- excluye choferes (ya vienen de choferes_estado)
      select 1 from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id and r.codigo = 'chofer_transportista'
    )
  order by u.nombre;
$$;

grant execute on function sgc.otros_rastreados() to authenticated;

-- 4) Habilitar el rastreo de Misael (jefe_flota/logistica → comparte_ubicacion=false
--    por rol). Override explícito por usuario. Reversible (delete de la fila).
insert into sgc.usuario_flags (usuario_id, flag, valor)
select u.id, 'comparte_ubicacion', true
from sgc.usuarios u
where u.nombre ilike '%misael%encarnacion%'
on conflict (usuario_id, flag) do update set valor = excluded.valor;
