import type { EntregaPorConfirmar } from '../services/conduces.service';
import type { FirmaPendiente } from '../services/inventario.service';

/** BD2 — de qué bandeja de origen viene una entrega por recibir. */
export type FuenteRecepcion = 'confirmar' | 'firmar';

/** BD2 — una entrega por RECIBIR, venga de "por confirmar" o de "por firmar". */
export interface EntregaPorRecibir {
  salidaId: string;
  fuente: FuenteRecepcion;
  titulo: string;
  fecha: string | null;
  emisor: string | null;
  /** Solo la fuente 'confirmar' registra faltantes por ítem + entrada de inventario. */
  soportaFaltantes: boolean;
  pendienteAlmacen: boolean;
}

/**
 * BD2 — fusiona las DOS bandejas del receptor ("por confirmar" + "por firmar") en una
 * sola "Entregas por recibir", DEDUPLICANDO por salida. Una entrega entregada con la
 * firma pendiente puede salir en ambas listas: gana la ruta más rica ('confirmar',
 * que además hace la entrada de inventario y captura la foto). Así cada entrega
 * aparece UNA sola vez y desaparece la redundancia AY2 de los dos contadores.
 */
export function fusionarEntregasPorRecibir(
  confirmar: EntregaPorConfirmar[],
  firmar: FirmaPendiente[],
): EntregaPorRecibir[] {
  const map = new Map<string, EntregaPorRecibir>();
  for (const e of confirmar) {
    map.set(e.id, {
      salidaId: e.id,
      fuente: 'confirmar',
      titulo: e.destino || e.bodega || 'Entrega',
      fecha: e.entregado_en || e.fecha || null,
      emisor: null,
      soportaFaltantes: true,
      pendienteAlmacen: false,
    });
  }
  for (const f of firmar) {
    if (map.has(f.salida_id)) continue; // ya cubierta por 'confirmar' (ruta más rica)
    map.set(f.salida_id, {
      salidaId: f.salida_id,
      fuente: 'firmar',
      titulo: f.obra || 'Entrega',
      fecha: f.fecha || null,
      emisor: f.emisor ?? null,
      soportaFaltantes: false,
      pendienteAlmacen: !!f.pendiente_almacen,
    });
  }
  return [...map.values()];
}
