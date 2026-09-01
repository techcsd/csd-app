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

/** AU12 — resultado de `buscar_articulos` (alias-aware): además del artículo, dice POR
 *  QUÉ coincidió, para poder mostrar "coincide con el apodo «X»". */
export interface ArticuloBusqueda extends ArticuloCat {
  match_por?: 'apodo' | 'codigo' | 'categoria' | 'nombre' | string;
  match_alias?: string | null;
}

/** AU12 — apodo/alias de un artículo. */
export interface ArticuloAlias {
  id: string;
  alias: string;
  creado_por: string | null;
  creador: string | null;
  created_at: string;
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
 * AU4 — material NO catalogado escrito como nota libre en el conduce (nombre +
 * cantidad + unidad). No toca stock; viaja en el conduce/PDF/confirmación y
 * dispara una alerta al admin/inventario para crear el artículo. Se envía por el
 * mismo outbox del conduce (RPC agregar_items_libres_conduce).
 */
export interface ItemLibre {
  nombre: string;
  cantidad: number;
  unidad: string;
}

/** AU4 — fila de la bandeja de material NO catalogado (material_no_catalogado_pendientes). */
export interface MaterialNoCatalogado {
  id: string;
  salida_id: string;
  conduce_numero: string;
  nombre: string;
  cantidad: number;
  unidad: string | null;
  articulo_vinculado_id: string | null;
  articulo_vinculado: string | null;
  reportado_por: string | null;
  proyecto: string | null;
  created_at: string;
  vinculado_at: string | null;
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
  /** BC4 — folio secuencial legible; se muestra como REQ-XXXXXX. */
  folio?: number | null;
  proyecto?: { nombre: string } | null;
  items?: SolicitudItem[];
}

/** BC4 — código citable de la requisición (REQ-XXXXXX) a partir del folio.
 *  Espejo de `requisicionCodigo` de la web (SGC/src/shared/models/solicitud.model.ts). */
export function requisicionCodigo(folio: number | null | undefined): string {
  return folio != null ? 'REQ-' + String(folio).padStart(6, '0') : '—';
}

/**
 * AY3 (follow-up app) — estado de la ORDEN DE COMPRA nacida de una de mis
 * requisiciones (RPC `mis_ordenes_de_compra`, scoped a solicitante_id). Permite
 * mostrar en "Mis requisiciones" que lo faltante ya se convirtió en orden y su
 * estado real (aprobada/recibida…). Keyed por `solicitud_id`.
 */
export interface MiOrdenCompra {
  solicitud_id: string;
  solicitud_estado: string;
  orden_id: string;
  numero: string;
  orden_estado: string;
  proveedor: string | null;
  total: number | null;
  creada_at: string | null;
}

/** AS7 — una fila de la bandeja de requisiciones (todas, por rol). */
export interface RequisicionBandeja {
  id: string;
  estado: string;
  urgencia: string;
  notas: string | null;
  created_at: string;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  solicitante_id: string | null;
  solicitante_nombre: string | null;
  items_count: number;
  tiene_conduce: boolean;
  tiene_compra: boolean;
}

/** AS7 — ítem del detalle de una requisición. */
export interface RequisicionDetalleItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string | null;
  talla: string | null;
  articulo_id: string | null;
  codigo: string | null;
}

/** AS7 — detalle completo de una requisición (bandeja). BC1/BC4 — enriquecido con
 *  folio (REQ-XXX), rol del solicitante, versión y datos de cancelación/cierre. */
export interface RequisicionDetalle {
  id: string;
  estado: string;
  urgencia: string;
  notas: string | null;
  created_at: string;
  updated_at: string | null;
  atendido_en: string | null;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  solicitante_id: string | null;
  solicitante_nombre: string | null;
  atendido_por_nombre: string | null;
  salida_id: string | null;
  solicitud_compra_id: string | null;
  items: RequisicionDetalleItem[];
  // BC4 — contexto etiquetado adicional.
  folio?: number | null;
  solicitante_rol?: string | null;
  version?: number | null;
  cancelada_motivo?: string | null;
  cerrada_en?: string | null;
  cerrada_por_nombre?: string | null;
  // BF6 — motivo del rechazo (para el flujo rechazada → corregir → reenviar).
  motivo_rechazo?: string | null;
}

/** BA6 — avance de un renglón: solicitado vs despachado vs pendiente. */
export interface RequisicionAvanceItem {
  articulo_id: string | null;
  descripcion: string;
  unidad: string | null;
  talla: string | null;
  solicitado: number;
  despachado: number;
  pendiente: number;
}

/** BB10 — una edición del autor sobre su requisición (para el historial). */
export interface RequisicionEdicion {
  editado_por: string | null;
  editado_por_nombre: string | null;
  editado_at: string;
  cambios: { antes?: unknown; despues?: unknown } | null;
}

/** BB10/BF6 — payload para editar una requisición pendiente o rechazada (autor).
 *  BF6 añade `proyectoId` (obra editable) — el campo que en la práctica se equivoca. */
export interface RequisicionEditar {
  id: string;
  urgencia?: string | null;
  notas?: string | null;
  proyectoId?: string | null;
  items?: { articulo_id: string | null; descripcion: string; cantidad: number; unidad: string | null; talla: string | null }[];
}

export const SOLICITUD_PASOS = ['pendiente', 'aprobada', 'entregada'] as const;
