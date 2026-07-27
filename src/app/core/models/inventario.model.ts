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
  /** EPP: the size must be entered when this article is added (V14). */
  requiere_talla: boolean;
  /** Packing/brand help ("ATADO 120 PZA", "REF. TOTAL / HILTI") shown as a hint. */
  nota: string | null;
  /** Z16 — 'propio_csd' | 'alquilado' | externo: para agrupar CSD/Alquilados + badge. */
  propiedad: string | null;
  /** Z17 — URL de la foto del artículo (thumbnail + detalle), o null. */
  imagen_url: string | null;
}

/** Z16 — ¿el artículo es alquilado/externo (no propio de CSD)? */
export function esArticuloExterno(propiedad: string | null | undefined): boolean {
  return !!propiedad && propiedad !== 'propio_csd';
}
/** Z16 — etiqueta corta de propiedad para el badge. */
export function propiedadLabel(propiedad: string | null | undefined): string {
  return esArticuloExterno(propiedad) ? 'Alquilado' : 'CSD';
}

export interface Existencia {
  articulo_id: string;
  nombre: string;
  codigo: string;
  unidad: string;
  cantidad: number;
  // Z18 — categoría del artículo, para agrupar existencias por categoría.
  categoria_id: number | null;
  // Z16/Z17 — propiedad (CSD/alquilado) + foto para badge y thumbnail.
  propiedad: string | null;
  imagen_url: string | null;
}

/** A line in a salida/entrada/solicitud cart. */
export interface MovItem {
  articulo_id: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

/** A cart line for the category-sheet selector (keeps categoria for grouping).
 *  `articulo_id` is null for a free-text "Otros" line (V14/08). `talla` is set
 *  for EPP that requires a size. `descripcion` holds the free-text for Otros. */
export interface CartLinea {
  articulo_id: string | null;
  nombre: string;
  unidad: string;
  categoria_id: number | null;
  cantidad: number;
  talla?: string | null;
  descripcion?: string | null;
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
