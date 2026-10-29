/**
 * CZ1/CZ2/CZ6 — Biblioteca de Cotizaciones de Tecnología. Espeja sgc.tec_cotizaciones
 * + sus dos M:N opcionales (compra tecnológica / equipo de inventario TI). La app
 * SOLO ve/busca/sube/liga-a-compra (DZ-25); ligar a equipos y corregir renglones es
 * trabajo de la web (el mockup CZ6 lo dice).
 */

export type CotizacionEstado = 'vigente' | 'usada' | 'descartada';
export type CotizacionFiltro = 'todas' | 'sin_vincular' | 'con_compra';

export interface LecturaCotizacionArticulo {
  descripcion: string;
  cantidad: number | null;
  unidad: string | null;
  precio: number | null;
}

/** Lo que la edge `leer-cotizacion` extrajo del PDF/foto (revisable, nunca autoritativo). */
export interface LecturaCotizacion {
  proveedor: string | null;
  fecha: string | null;
  moneda: string | null;
  articulos: LecturaCotizacionArticulo[];
  itbis: number | null;
  total: number | null;
}

export interface LeerCotizacionResultado {
  ok: boolean;
  lectura?: LecturaCotizacion;
  confianza?: Record<string, number>;
  modelo?: string;
  costo_usd?: number;
  error?: string;
  error_code?: string;
}

export interface CotizacionRow {
  id: string;
  titulo: string;
  proveedor: string | null;
  fecha: string | null;
  moneda: 'DOP' | 'USD';
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  estado: CotizacionEstado;
  archivo_path: string | null;
  archivo_nombre: string | null;
  notas: string | null;
  creado_por: string | null;
  created_at: string;
  // resuelto en el cliente (chips de vínculo)
  compra_id?: string | null;
  compra_titulo?: string | null;
  equipo_codigo?: string | null;
}

export interface CotizacionCompraLink {
  id: string;
  titulo: string | null;
  estado: string | null;
}
export interface CotizacionEquipoLink {
  id: string;
  codigo: string | null;
  nombre: string;
}

export interface CotizacionDetalle extends CotizacionRow {
  lectura: LecturaCotizacion | null;
  lectura_costo_usd: number | null;
  url: string | null;
  compras: CotizacionCompraLink[];
  equipos: CotizacionEquipoLink[];
}

/** Selector "ligar a compra" (opcional, al subir). */
export interface CompraTecSelector {
  id: string;
  titulo: string | null;
  estado: string;
}
