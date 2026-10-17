/** CO8 — Compras tecnológicas (categoria='tecnologia' en `solicitudes_compra`). */
export type CompraTecEstado = 'borrador' | 'esperando_aprobacion' | 'aprobada' | 'rechazada' | 'comprada';

export interface CompraTecItem {
  id: string;
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string | null;
  precio_unitario: number | null;
  unidad: string | null;
}

export interface CompraTecAdjunto {
  id: string;
  tipo: 'cotizacion' | 'factura' | 'otro';
  proveedor: string | null;
  monto: number | null;
  path: string;
  nombre: string;
  elegida: boolean;
  created_at: string;
  fecha: string | null;
  /** Extracción de IA al leer la cotización (proveedor/fecha/artículos/ITBIS/total); null si no se leyó o se llenó a mano. */
  lectura: Record<string, unknown> | null;
  lectura_costo_usd: number | null;
  /** URL firmada (best-effort; null offline o sin acceso). */
  url?: string | null;
}

export interface CompraTecRow {
  id: string;
  estado: CompraTecEstado;
  titulo: string | null;
  urgencia: 'normal' | 'urgente';
  notas: string | null;
  created_at: string;
  enviada_at: string | null;
  solicitante_id: string;
  solicitante_nombre?: string | null;
  aprobador_id: string | null;
  aprobador_nombre?: string | null;
  itbis_incluido: boolean;
  subtotal: number | null;
  itbis: number | null;
  /** Total calculado y guardado server-side; autoritativo cuando no es null. */
  total: number | null;
}

export interface CompraTecDetalle extends CompraTecRow {
  decidida_por: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  items: CompraTecItem[];
  adjuntos: CompraTecAdjunto[];
}
