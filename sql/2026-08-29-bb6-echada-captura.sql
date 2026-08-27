-- BB6 (PROMPT-20 FASE 1) — la HORA de captura de la echada manda sobre la de sync.
--
-- Problema: una echada capturada offline se inserta al SINCRONIZAR, así que
-- `registros_combustible.created_at` = hora de sync, no la hora real en que el
-- chofer echó el combustible. El outbox de la app SÍ conserva la hora real de
-- captura (`capturado_en`). Este RPC deja que la app "corrija" el created_at a
-- la hora real de captura justo después de insertar la echada — sin tocar la
-- función crítica `registrar_combustible_app` (AW3), 100% aditivo.
--
-- Regla: solo lo mueve HACIA ATRÁS (captura precede a sync) y nunca al futuro;
-- solo el usuario que la registró (o admin) puede corregirla.

create or replace function sgc.combustible_marcar_captura(
  p_id uuid,
  p_capturado_en timestamptz
) returns void
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_id is null or p_capturado_en is null then return; end if;
  update sgc.registros_combustible r
     set created_at = p_capturado_en
   where r.id = p_id
     and (r.registrado_por = v_uid or sgc.is_admin())
     and p_capturado_en <= now() + interval '2 minutes'     -- nunca al futuro (reloj adelantado)
     and p_capturado_en <  r.created_at + interval '2 minutes'; -- solo hacia atrás (captura < sync)
end;
$function$;

grant execute on function sgc.combustible_marcar_captura(uuid, timestamptz) to authenticated;
