/**
 * EA1 — Proveedores de Tecnología. Espeja `sgc.tec_proveedores` + hijas (contactos,
 * trabajos, facturas) creadas por la web (PROMPT-156 F3). La app es de SOLO LECTURA +
 * contacto (DEFAULT EA-09): el alta/edición vive en la web. Mismos nombres de campo
 * que el padre.
 */

export type TecProveedorEstado = 'activo' | 'inactivo';
export type TecTrabajoEstado = 'cotizado' | 'en_curso' | 'completado' | 'cancelado';
export type TecFacturaEstado = 'pendiente' | 'pagada' | 'anulada';
export type TecMoneda = 'DOP' | 'USD';

/** Fila de la lista = lo que devuelve la RPC `buscar_tec_proveedores`. */
export interface TecProveedorRow {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  categoria: string | null;
  servicio: string | null;
  estado: TecProveedorEstado;
  valoracion: number | null;
  etiquetas: string[];
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  contacto_whatsapp: string | null;
  contacto_correo: string | null;
  /** Dónde coincidió la búsqueda (nombre/servicio/contacto/trabajo/cotizacion/varios). */
  coincidencia: string | null;
  puntaje: number;
}

export interface TecProveedorContacto {
  id: string;
  proveedor_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  whatsapp: string | null;
  correo: string | null;
  principal: boolean;
  notas: string | null;
}

export interface TecProveedorTrabajo {
  id: string;
  proveedor_id: string;
  fecha: string | null;
  titulo: string;
  descripcion: string | null;
  costo: number | null;
  moneda: TecMoneda;
  estado: TecTrabajoEstado;
}

export interface TecProveedorFactura {
  id: string;
  proveedor_id: string;
  numero: string;
  fecha: string | null;
  monto: number | null;
  itbis: number | null;
  moneda: TecMoneda;
  estado: TecFacturaEstado;
  fecha_pago: string | null;
  archivo_path: string | null;
  archivo_nombre: string | null;
  notas: string | null;
}

export interface TecProveedorFicha {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  rnc: string | null;
  categoria: string | null;
  servicio: string | null;
  etiquetas: string[];
  direccion: string | null;
  ciudad: string | null;
  web: string | null;
  notas: string | null;
  estado: TecProveedorEstado;
  valoracion: number | null;
}

export interface TecProveedorDetalle {
  ficha: TecProveedorFicha;
  contactos: TecProveedorContacto[];
  trabajos: TecProveedorTrabajo[];
  facturas: TecProveedorFactura[];
}

export type TecProveedorTab = 'resumen' | 'contactos' | 'trabajos' | 'facturas';
