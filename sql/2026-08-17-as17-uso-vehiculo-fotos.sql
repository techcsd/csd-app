-- =============================================================================
-- AS17 / PROMPT-18 FASE 5 — Uso de vehículo con 4 fotos rápidas.
-- =============================================================================
-- El "Uso de vehículo" solo capturaba km + nivel. Se agregan 4 fotos guiadas
-- (frente / lateral izq / lateral der / trasera) a la sesión de uso. Se guardan
-- como columnas en `vehiculo_usos` (paths del bucket `conduces`/`vehiculos`).
-- Se hace con un RPC aditivo `set_uso_fotos` (NO se toca el RPC grande
-- iniciar_uso_vehiculo): el cliente llama iniciar_uso_vehiculo, y con el uso_id
-- que devuelve sube las fotos y las adjunta.
-- =============================================================================
alter table sgc.vehiculo_usos
  add column if not exists foto_frente_path      text,
  add column if not exists foto_lateral_izq_path text,
  add column if not exists foto_lateral_der_path text,
  add column if not exists foto_trasera_path     text;

create or replace function sgc.set_uso_fotos(
  p_uso_id      uuid,
  p_frente      text default null,
  p_lateral_izq text default null,
  p_lateral_der text default null,
  p_trasera     text default null
)
returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_owner uuid;
begin
  select usuario_id into v_owner from sgc.vehiculo_usos where id = p_uso_id;
  if v_owner is null then raise exception 'Sesión de uso no encontrada.'; end if;
  -- Solo el dueño de la sesión (o flota/admin) adjunta las fotos.
  if not (v_owner = auth.uid() or sgc.is_admin() or sgc.tiene_modulo('flota')) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;
  update sgc.vehiculo_usos set
    foto_frente_path      = coalesce(p_frente,      foto_frente_path),
    foto_lateral_izq_path = coalesce(p_lateral_izq, foto_lateral_izq_path),
    foto_lateral_der_path = coalesce(p_lateral_der, foto_lateral_der_path),
    foto_trasera_path     = coalesce(p_trasera,     foto_trasera_path)
  where id = p_uso_id;
end;
$function$;

grant execute on function sgc.set_uso_fotos(uuid, text, text, text, text) to authenticated;
