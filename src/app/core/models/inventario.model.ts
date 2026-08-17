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
  // AS12 — ubicación: vinculada a una obra o propia (coordenadas/mapa).
  proyecto_id?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  direccion_geo?: string | null;
  ubicacion_hereda_proyecto?: boolean | null;
  ubicacion_metodo?: string | null;
}

/** AS12 — datos para guardar la ubicación de un almacén. */
export interface BodegaUbicacion {
  proyecto_id: string | null;
  latitud: number | null;
  longitud: number | null;
  direccion_geo: string | null;
  ubicacion_hereda_proyecto: boolean;
  ubicacion_metodo: string | null;
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

/** Y10 — una línea de un conteo/ajuste en el historial (antes vs contada). */
export interface ConteoItemHist {
  cantidad_antes: number;
  cantidad_contada: number;
  articulo?: { nombre: string; codigo: string } | null;
}

/** Y10 — un conteo/ajuste de inventario en el historial (parity con la web). */
export interface ConteoHistorial {
  id: string;
  motivo: string | null;
  tipo: string | null; // 'ajuste' | 'chequeo_semanal'
  observaciones: string | null;
  created_at: string;
  bodega?: { nombre: string } | null;
  creado?: { nombre: string } | null;
  items?: ConteoItemHist[];
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

/**
 * AD6 — compra/retiro de ferretería registrado por el CHOFER desde Transporte.
 * Queda como entrada PENDIENTE (chofer_registrar_compra_ferreteria) hasta que
 * Almacén la confirma; el chofer nunca sube stock por su cuenta (antifraude).
 */
/** AF32/AF31 — una ferretería visible para el chofer (origen de conduce/compra). */
export interface Ferreteria {
  id: string;
  nombre: string;
  direccion: string | null;
  lat: number | null;
  lng: number | null;
  telefono: string | null;
  contacto: string | null;
}

export interface CompraFerreteriaCaptura {
  bodegaId: string;
  proyectoId: string | null;
  /** # de factura / referencia del recibo. */
  referencia: string | null;
  /** Nombre de la ferretería/suplidor (texto libre → va a observaciones). */
  proveedor: string | null;
  /** AF31/AF32 — id del proveedor-ferretería (del catálogo ferreterias_visibles). */
  proveedorId?: string | null;
  observaciones: string | null;
  /** Materiales propuestos (Almacén ajusta al confirmar). Opcional. */
  items: { articulo_id: string; cantidad: number }[];
  /** Foto del recibo, solo-cámara. */
  foto: Blob | null;
  /** AF12 — foto de la mercancía recibida (además del recibo), solo-cámara. */
  fotoMercancia?: Blob | null;
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
