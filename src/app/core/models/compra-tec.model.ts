/** CO8 — Compras tecnológicas (categoria='tecnologia' en `solicitudes_compra`). */
export type CompraTecEstado = 'borrador' | 'esperando_aprobacion' | 'aprobada' | 'rechazada' | 'comprada';

export interface CompraTecItem {
  id: string;
  descripcion: string;
  cantidad: number;
  proveedor_sugerido: string | null;
  precio_unitario: number | null;
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
  /** URL firmada (best-effort; null offline o sin acceso). */
  url?: string | null;
}

export interface CompraTecRow {
  id: string;
  estado: CompraTecEstado;
  notas: string | null;
  created_at: string;
  enviada_at: string | null;
  solicitante_id: string;
  solicitante_nombre?: string | null;
  aprobador_id: string | null;
  aprobador_nombre?: string | null;
  /** Suma de `cantidad * precio_unitario` de los renglones (best-effort). */
  total?: number | null;
}

export interface CompraTecDetalle extends CompraTecRow {
  decidida_por: string | null;
  decidida_at: string | null;
  motivo_rechazo: string | null;
  items: CompraTecItem[];
  adjuntos: CompraTecAdjunto[];
}
