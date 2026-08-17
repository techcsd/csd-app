-- =============================================================================
-- AS2 / PROMPT-18 FASE 2 — Push/aviso al despachante: "Conduce por firmar".
-- =============================================================================
-- El backend de firma remota ya existe (conduce_firmar_despachante,
-- mis_conduces_por_firmar, y conduce_marcar_entregado bloquea la entrega con
-- DR456 hasta la firma). Faltaba AVISAR al despachante cuando se emite un conduce
-- con él como despachante del sistema. Se hace con un trigger AFTER INSERT
-- (aditivo; NO se toca el RPC crear_conduce_simple). El aviso enlaza al detalle
-- del conduce, donde el despachante firma desde SU sesión.
-- =============================================================================
create or replace function sgc.tg_conduce_notificar_despachante()
returns trigger
language plpgsql
security definer
set search_path to 'sgc', 'pg_temp'
as $function$
begin
  if new.despachante_usuario_id is not null
     and new.despachante_usuario_id is distinct from new.creado_por
     and coalesce(new.estado,'') <> 'anulado' then
    perform sgc.notificar(
      new.despachante_usuario_id,
      'conduce',
      'Tienes un conduce por firmar',
      'Se emitió el conduce ' || ('CND-' || upper(left(new.id::text, 8))) ||
        '. Ábrelo y fírmalo desde tu teléfono para que el chofer pueda entregarlo.',
      '/transporte/conduce-detalle/' || new.id::text);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_conduce_notificar_despachante on sgc.salidas_inventario;
create trigger trg_conduce_notificar_despachante
  after insert on sgc.salidas_inventario
  for each row
  execute function sgc.tg_conduce_notificar_despachante();
