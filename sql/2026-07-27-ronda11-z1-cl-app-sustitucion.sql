-- Ronda 11 · Z1 (app) — registrar_cl_app ahora mapea la firma EN SUSTITUCIÓN.
-- ADITIVO y RETROCOMPATIBLE: la firma del outbox de la app ya trae usuario_id;
-- este cambio añade el mapeo de en_sustitucion_de / en_sustitucion_de_nombre
-- (las columnas ya existen desde 2026-07-26-ronda11-z3). Builds viejos de la app
-- no envían esas claves → nullif() las deja en NULL (sin romper nada). El resto
-- del cuerpo es idéntico al vigente.
CREATE OR REPLACE FUNCTION sgc.registrar_cl_app(
  p_id uuid, p_proyecto_id uuid, p_plantilla_id uuid, p_elemento_id uuid,
  p_vaciado_id uuid, p_bloque text, p_eje text, p_plano_path text,
  p_observaciones text, p_items jsonb, p_fotos jsonb, p_firmas jsonb,
  p_capturado_en timestamp with time zone
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'sgc', 'pg_temp'
AS $function$
begin
  if auth.uid() is null then raise exception 'No autenticado'; end if;
  if not (sgc.is_admin() or sgc.tiene_modulo('proyectos') or sgc.tiene_modulo('bitacora')) then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from sgc.cl_registros where id = p_id) then return p_id; end if;

  insert into sgc.cl_registros (id, proyecto_id, plantilla_id, elemento_id, vaciado_id, bloque, eje, plano_path, observaciones, creado_por)
  values (p_id, p_proyecto_id, p_plantilla_id, p_elemento_id, p_vaciado_id, p_bloque, p_eje, p_plano_path, p_observaciones, auth.uid());

  insert into sgc.cl_registro_items (registro_id, etiqueta, seccion, cumple, comentario, orden)
  select p_id, i->>'etiqueta', i->>'seccion', (i->>'cumple')::boolean, i->>'comentario', coalesce((i->>'orden')::int,0)
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) i;

  insert into sgc.cl_registro_fotos (registro_id, storage_path, correcto, descripcion)
  select p_id, f->>'storage_path', (f->>'correcto')::boolean, f->>'descripcion'
  from jsonb_array_elements(coalesce(p_fotos,'[]'::jsonb)) f where nullif(f->>'storage_path','') is not null;

  -- Z1/Z3 — firmas con usuario ligado + firma en sustitución.
  insert into sgc.cl_registro_firmas
    (registro_id, rol, usuario_id, nombre, firma_path, metodo, orden, en_sustitucion_de, en_sustitucion_de_nombre)
  select p_id, s->>'rol', nullif(s->>'usuario_id','')::uuid, s->>'nombre', s->>'firma_path',
         coalesce(nullif(s->>'metodo',''),'pad'), coalesce((s->>'orden')::int,0),
         nullif(s->>'en_sustitucion_de','')::uuid, nullif(s->>'en_sustitucion_de_nombre','')
  from jsonb_array_elements(coalesce(p_firmas,'[]'::jsonb)) s;

  return p_id;
end; $function$;
