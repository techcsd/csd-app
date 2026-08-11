/**
 * AL2 — Inventario tecnológico (activos de TI). Espeja sgc.tec_equipos +
 * sgc.tec_equipo_tipos. Multi-foto con portada, precio con moneda, ubicación por
 * bodega/Oficina Central. La app escribe por outbox (guardar_tec_equipo_app).
 */

export type TecEstado = 'activo' | 'en_reparacion' | 'en_stock' | 'dado_de_baja';

export const TEC_ESTADO_LABEL: Record<TecEstado, string> = {
  activo: 'Asignado / en uso',
  en_stock: 'En stock',
  en_reparacion: 'En reparación',
  dado_de_baja: 'Dado de baja',
};

/** Tipo del catálogo administrable (tec_equipo_tipos). */
export interface TecTipo {
  id: string;
  clave: string;
  label: string;
  orden: number;
  activo: boolean;
}

export interface TecEquipo {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo_id: string | null;
  tipo: string | null; // legacy texto
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEstado;
  empleado_id: string | null;
  asignado_en: string | null;
  bodega_id: string | null;
  ubicacion: string | null; // legacy texto
  notas: string | null;
  costo: number | null;
  moneda: 'DOP' | 'USD';
  fecha_compra: string | null;
  garantia_hasta: string | null;
  fotos: string[] | null;
  foto_portada: string | null;
  foto_path: string | null;
  created_at: string;
  updated_at: string | null;
  // join opcional
  empleado?: { nombre: string; apellido: string | null; cargo: string | null } | null;
}

/** Lo que el wizard entrega a TecnologiaService.enqueueGuardar(). */
export interface TecEquipoCaptura {
  /** presente en edición; ausente = alta. */
  id?: string;
  nombre: string;
  tipoId: string | null;
  bodegaId: string | null;
  costo: number | null;
  moneda: 'DOP' | 'USD';
  marca: string | null;
  modelo: string | null;
  serie: string | null;
  estado: TecEstado;
  notas: string | null;
  /** paths ya en storage (edición). */
  fotosExistentes: string[];
  /** capturas nuevas (blob + clave de slot). */
  fotosNuevas: { key: string; blob: Blob }[];
  /** portada: un path existente O una clave de slot nueva. */
  portadaKey: string | null;
}
