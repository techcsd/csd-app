export interface Bodega {
  id: string;
  nombre: string;
}

/** Full warehouse row for the management screen (R12). */
export interface BodegaAdmin {
  id: string;
  nombre: string;
  descripcion: string | null;
  ubicacion: string | null;
  activo: boolean;
  es_principal: boolean;
}

/** Article category (R16). destacada = shown first (Clavos/Madera/Acero…). */
export interface CategoriaInv {
  id: number;
  nombre: string;
  padre_id: number | null;
  orden: number;
  destacada: boolean;
}

export interface ArticuloCat {
  id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  categoria_id: number | null;
}

export interface Existencia {
  articulo_id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  cantidad: number;
}

/** A line in a salida/entrada/solicitud cart. */
export interface MovItem {
  articulo_id: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

export type Urgencia = 'normal' | 'urgente';

export interface SolicitudItem {
  descripcion: string | null;
  cantidad: number;
  unidad: string | null;
}

export interface Solicitud {
  id: string;
  estado: string;
  urgencia: string;
  notas: string | null;
  created_at: string;
  proyecto?: { nombre: string } | null;
  items?: SolicitudItem[];
}

export const SOLICITUD_PASOS = ['pendiente', 'aprobada', 'entregada'] as const;
