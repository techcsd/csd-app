import type { EntregaPorConfirmar } from '../services/conduces.service';
import type { FirmaPendiente } from '../services/inventario.service';
import type { Conduce } from '../models/transporte.model';

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
  /**
   * CM4 — fase del conduce (server-side). La fuente 'confirmar' ya la trae; la de
   * 'firmar' (receptor designado) la enriquece la pantalla con `conduce_fase`. Si una
   * entrega todavía NO ha salido (emitido/en ruta), el receptor la ve "En camino" y
   * NO puede firmar hasta que el chofer la entregue (Nota #197).
   */
  fase?: string | null;
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
      fase: e.fase ?? null, // CM4 — la fuente 'confirmar' ya trae la fase del servidor.
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

/**
 * CT5 — decide qué conduce usar para retomar el borrador de "Recibir material"
 * (`inventario:recibir`):
 * 1) si el conduce sigue en la lista de pendientes (online o cache fresco) →
 *    esa copia, la más actualizada.
 * 2) si no está en la lista pero el borrador guardó una copia del conduce
 *    (`conduceSnapshot`) y NO hay señal → el snapshot: sin red no se puede
 *    confirmar nada, así que NO se descarta (antes se perdía el borrador solo
 *    por no verlo en una lista que, offline, puede venir vacía o desactualizada).
 * 3) si no está en la lista Y hay señal → null: el servidor confirma que ya no
 *    está pendiente (alguien más lo recibió, o ya se envió) → se descarta.
 */
export function resolverConduceDeBorrador(
  expandedId: string,
  conduceSnapshot: Conduce | null,
  conducesEnLista: Conduce[],
  online: boolean,
): Conduce | null {
  const enLista = conducesEnLista.find((c) => c.id === expandedId) ?? null;
  if (enLista) return enLista;
  if (!online && conduceSnapshot) return conduceSnapshot;
  return null;
}
