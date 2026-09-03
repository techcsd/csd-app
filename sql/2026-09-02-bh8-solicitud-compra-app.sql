-- ════════════════════════════════════════════════════════════════════════════
--  BH8 — Solicitud de compra desde la app (offline-safe) + BH7 lista con procedencia
--  ---------------------------------------------------------------------------
--  La app no tocaba estas tablas. `crear_solicitud_compra` (web) ya valida autoría
--  pero NO es idempotente → un reintento del outbox crearía una solicitud duplicada.
--  Añadimos:
--   1) `solicitudes_compra.client_id` (UUID, unique parcial) — llave de idempotencia.
--   2) `crear_solicitud_compra_app(...)` SECURITY DEFINER + idempotente por client_id
--      (mismo patrón que crear_retiro_material). Manual = sin origen_requisicion.
--   3) `mis_solicitudes_compra_app()` — lista de solo lectura con estado + procedencia
--      (folio REQ de la requisición que la originó, si aplica).
--  Aditivo, backward-compatible (no toca crear_solicitud_compra ni la web).
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Idempotencia
alter table sgc.solicitudes_compra add column if not exists client_id uuid;
create unique index if not exists solicitudes_compra_client_id_uk
  on sgc.solicitudes_compra (client_id) where client_id is not null;

-- 2) Alta idempotente desde la app
create or replace function sgc.crear_solicitud_compra_app(
  p_proyecto_id uuid,
  p_notas text,
  p_items jsonb,
  p_categoria text default null,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado.'; end if;

  -- Idempotencia (outbox): un reenvío con el mismo client_id devuelve la misma solicitud.
  if p_client_id is not null then
    select id into v_id from sgc.solicitudes_compra where client_id = p_client_id;
    if v_id is not null then return v_id; end if;
  end if;

  insert into sgc.solicitudes_compra (proyecto_id, solicitante_id, notas, categoria, client_id)
  values (p_proyecto_id, v_uid, nullif(btrim(p_notas), ''), nullif(btrim(p_categoria), ''), p_client_id)
  returning id into v_id;

  insert into sgc.solicitud_compra_items (solicitud_id, descripcion, cantidad, proveedor_sugerido, unidad)
  select v_id,
         btrim(i->>'descripcion'),
         coalesce((i->>'cantidad')::numeric, 0),
         nullif(btrim(i->>'proveedor_sugerido'), ''),
         nullif(btrim(i->>'unidad'), '')
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where coalesce(btrim(i->>'descripcion'), '') <> '';

  return v_id;
exception
  when unique_violation then
    -- carrera de dos reintentos: devuelve la que ya quedó.
    select id into v_id from sgc.solicitudes_compra where client_id = p_client_id;
    return v_id;
end;
$function$;

grant execute on function sgc.crear_solicitud_compra_app(uuid, text, jsonb, text, uuid) to authenticated;

-- 3) Mis solicitudes de compra (solo lectura) con procedencia (folio REQ si nació de una)
create or replace function sgc.mis_solicitudes_compra_app()
returns table(
  id uuid, proyecto_id uuid, proyecto_nombre text, estado text, notas text,
  categoria text, created_at timestamptz, origen_requisicion_id uuid,
  origen_folio bigint, items jsonb
)
language sql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
  select sc.id, sc.proyecto_id, p.nombre, sc.estado, sc.notas,
         sc.categoria, sc.created_at, sc.origen_requisicion_id,
         sm.folio,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'descripcion', it.descripcion,
                    'cantidad', it.cantidad,
                    'unidad', it.unidad,
                    'proveedor_sugerido', it.proveedor_sugerido))
           from sgc.solicitud_compra_items it where it.solicitud_id = sc.id
         ), '[]'::jsonb)
  from sgc.solicitudes_compra sc
  left join sgc.proyectos p on p.id = sc.proyecto_id
  left join sgc.solicitudes_material sm on sm.id = sc.origen_requisicion_id
  where sc.solicitante_id = auth.uid() or sgc.is_admin()
  order by sc.created_at desc
  limit 200;
$function$;

grant execute on function sgc.mis_solicitudes_compra_app() to authenticated;
