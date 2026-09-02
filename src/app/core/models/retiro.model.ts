/** BG4 — Retiro de material dañado (espejo de la requisición, en reversa). */

export type RetiroEstado =
  | 'pendiente'
  | 'aprobada'
  | 'en_retiro'
  | 'en_cuarentena'
  | 'dispuesta'
  | 'rechazada'
  | 'cancelada';

export type RetiroMotivoDano = 'danado_obra' | 'defecto_fabrica' | 'vencido' | 'otro';

export type RetiroDisposicion = 'descarte' | 'reparacion' | 'devolucion';

export interface RetiroItemCaptura {
  articulo_id: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
}

/** Lo que captura el ingeniero en la obra (fotos OBLIGATORIAS). */
export interface RetiroCaptura {
  proyectoId: string;
  motivoDano: RetiroMotivoDano;
  motivoDanoDetalle: string | null;
  notas: string | null;
  items: RetiroItemCaptura[];
  fotos: Blob[];
  esPrueba: boolean;
}

/** Fila del listado "Mis retiros" (RPC retiros_listado). */
export interface RetiroListado {
  id: string;
  folio: number;
  proyecto_id: string;
  proyecto_nombre: string | null;
  solicitante_nombre: string | null;
  motivo_dano: RetiroMotivoDano;
  motivo_dano_detalle: string | null;
  estado: RetiroEstado;
  disposicion: RetiroDisposicion | null;
  items_count: number;
  fotos_count: number;
  es_prueba: boolean;
  created_at: string;
}

/** Detalle completo (RPC retiro_detalle). */
export interface RetiroDetalle {
  retiro: {
    id: string;
    folio: number;
    proyecto_id: string;
    proyecto_nombre: string | null;
    almacen_nombre: string | null;
    solicitante_nombre: string | null;
    motivo_dano: RetiroMotivoDano;
    motivo_dano_detalle: string | null;
    estado: RetiroEstado;
    disposicion: RetiroDisposicion | null;
    disposicion_nota: string | null;
    notas: string | null;
    rechazada_motivo: string | null;
    cancelada_motivo: string | null;
    created_at: string;
  };
  items: Array<{ articulo_id: string | null; descripcion: string; cantidad: number; unidad: string | null }>;
  fotos: Array<{ path: string; nombre: string | null }>;
  error?: string;
}

/** Etiquetas legibles. */
export const RETIRO_MOTIVO_LABEL: Record<RetiroMotivoDano, string> = {
  danado_obra: 'Dañado en obra',
  defecto_fabrica: 'Defecto de fábrica',
  vencido: 'Vencido',
  otro: 'Otro',
};

export const RETIRO_ESTADO_LABEL: Record<RetiroEstado, string> = {
  pendiente: 'Pendiente',
  aprobada: 'Aprobada',
  en_retiro: 'En retiro',
  en_cuarentena: 'En cuarentena',
  dispuesta: 'Dispuesta',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
};

/** RET-000123 (patrón BC4). */
export function retiroCodigo(folio: number | null | undefined): string {
  return folio ? `RET-${String(folio).padStart(6, '0')}` : 'RET-—';
}
