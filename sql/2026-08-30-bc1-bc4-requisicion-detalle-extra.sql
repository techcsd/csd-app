-- ============================================================================
-- PROMPT-22 (BC) FASE 1 — BC1+BC4: el detalle de la requisición en la app necesita
--   MÁS contexto etiquetado: código citable (REQ-XXXXXX ← folio BC4), el ROL del
--   solicitante, la versión (BB10), y el motivo/quién si fue cancelada/cerrada
--   (BA6). Se EXTIENDE `requisicion_detalle` de forma ADITIVA (mismas firma y tipo
--   de retorno jsonb → `create or replace` seguro; la web solo GANA claves nuevas).
--
-- El avance de despachos (renglón), el historial de ediciones y el permiso de
-- gestión ya viven en RPCs propias (requisicion_avance / requisicion_ediciones /
-- puede_gestionar_requisicion — BA6/BB10): la app las consume aparte. Aquí solo
-- se enriquece la cabecera del detalle.
--
-- Aditivo / idempotente / retrocompatible. Beneficia también a la web (paridad).
-- Apply: node scripts/apply-migration.mjs sql/2026-08-30-bc1-bc4-requisicion-detalle-extra.sql
-- ============================================================================
set search_path = sgc, public;

-- Columnas que las RPCs de cierre/cancelación (BA6) ya escriben — se garantizan
-- por si alguna migración previa no las dejó (idempotente, no pisa datos).
alter table sgc.solicitudes_material add column if not exists cancelada_motivo text;
alter table sgc.solicitudes_material add column if not exists cerrada_por uuid references sgc.usuarios(id);
alter table sgc.solicitudes_material add column if not exists cerrada_en timestamptz;

create or replace function sgc.requisicion_detalle(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'sgc', 'pg_temp'
as $$
declare
  v_owner uuid;
  v jsonb;
begin
  select solicitante_id into v_owner from sgc.solicitudes_material where id = p_id;
  if v_owner is null then return null; end if;
  if not (sgc.puede_ver_todas_requisiciones() or v_owner = auth.uid()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', s.id, 'estado', s.estado, 'urgencia', s.urgencia, 'notas', s.notas,
    'created_at', s.created_at, 'updated_at', s.updated_at, 'atendido_en', s.atendido_en,
    'proyecto_id', s.proyecto_id, 'proyecto_nombre', p.nombre,
    'solicitante_id', s.solicitante_id, 'solicitante_nombre', u.nombre,
    'atendido_por_nombre', ua.nombre,
    'salida_id', s.salida_id, 'solicitud_compra_id', s.solicitud_compra_id,
    -- BC4 — código citable + contexto etiquetado.
    'folio', s.folio,
    'solicitante_rol', (
      select coalesce(r.nombre, r.codigo)
      from sgc.usuarios_roles ur
      join sgc.roles r on r.id = ur.rol_id
      where ur.usuario_id = s.solicitante_id
      order by r.id
      limit 1
    ),
    -- BB10 — versión (sube en cada edición del autor).
    'version', coalesce(s.version, 1),
    -- BA6 — cierre / cancelación (motivo + quién + cuándo).
    'cancelada_motivo', s.cancelada_motivo,
    'cerrada_en', s.cerrada_en,
    'cerrada_por_nombre', uc.nombre,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'descripcion', coalesce(nullif(i.descripcion, ''), a.nombre),
        'cantidad', i.cantidad, 'unidad', i.unidad, 'talla', i.talla,
        'articulo_id', i.articulo_id, 'codigo', a.codigo
      ) order by coalesce(nullif(i.descripcion, ''), a.nombre))
      from sgc.solicitud_material_items i
      left join sgc.articulos a on a.id = i.articulo_id
      where i.solicitud_id = s.id
    ), '[]'::jsonb)
  ) into v
  from sgc.solicitudes_material s
  left join sgc.proyectos p on p.id = s.proyecto_id
  left join sgc.usuarios  u on u.id = s.solicitante_id
  left join sgc.usuarios  ua on ua.id = s.atendido_por
  left join sgc.usuarios  uc on uc.id = s.cerrada_por
  where s.id = p_id;

  return v;
end;
$$;

grant execute on function sgc.requisicion_detalle(uuid) to authenticated;
