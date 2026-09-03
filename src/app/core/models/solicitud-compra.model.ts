/**
 * BH7/BH8 — Solicitud de compra desde la app. Concepto DISTINTO de la Requisición
 * (`solicitudes_material`): la solicitud de compra (`solicitudes_compra`) es lo que
 * Compras (Raykler) pide comprar — a mano o auto-generada por el faltante de una
 * requisición. La app la crea offline por outbox (idempotente vía client_id).
 */
export type SolicitudCompraEstado = 'pendiente' | 'convertida' | 'rechazada';

/** Un renglón libre de la solicitud (no catalogado). */
export interface SolicitudCompraItem {
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  proveedor_sugerido: string | null;
}

/** Lo que se captura en el teléfono para crear una solicitud de compra. */
export interface SolicitudCompraCaptura {
  proyectoId: string | null;
  notas: string | null;
  categoria: string | null;
  items: SolicitudCompraItem[];
}

/** Una solicitud de compra en "Mis solicitudes" (solo lectura), con procedencia. */
export interface MiSolicitudCompra {
  id: string;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  estado: SolicitudCompraEstado;
  notas: string | null;
  categoria: string | null;
  created_at: string;
  /** Si nació del faltante de una requisición, su id + folio (procedencia, BH7). */
  origen_requisicion_id: string | null;
  origen_folio: number | null;
  items: SolicitudCompraItem[];
}

export const SOLICITUD_COMPRA_ESTADO_META: Record<
  SolicitudCompraEstado,
  { label: string; icon: string }
> = {
  pendiente: { label: 'Pendiente', icon: '🕒' },
  convertida: { label: 'En orden de compra', icon: '🧾' },
  rechazada: { label: 'Rechazada', icon: '✕' },
};
