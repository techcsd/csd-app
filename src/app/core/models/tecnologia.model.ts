/**
 * AL2/DA — Inventario tecnológico (activos de TI). Espeja sgc.tec_equipos +
 * sgc.tec_equipo_tipos + sgc.tec_equipo_specs (DA2) + catálogos de situación/
 * condición (DA1). Multi-foto con portada, precio con moneda, ubicación por
 * bodega/Oficina Central. La app escribe por outbox (guardar_tec_equipo_app +
 * columnas nuevas directo a tabla, mismo gate RLS — DA-19).
 */

/** Fila de un catálogo administrable (tec_equipo_tipos/estados/condiciones). */
export interface TecCatalogoItem {
  id: string;
  clave: string;
  label: string;
  orden: number;
  activo: boolean;
}

/**
 * DA7/DA-04 — situación y condición dejaron de ser un union fijo: son catálogos
 * (tec_equipo_estados/tec_equipo_condiciones) que la app pinta igual que ya
 * pinta tec_equipo_tipos — nunca hardcodear las claves aquí.
 */
export type TecEquipoEstado = TecCatalogoItem;
export type TecEquipoCondicion = TecCatalogoItem;

/** Tipo del catálogo administrable (tec_equipo_tipos). */
export interface TecTipo extends TecCatalogoItem {
  /** DA-03 — qué bloques de specs mostrar: computadora | radio | bateria | dron. */
  grupos_campos: string[];
}

export type TecCostoOrigen = 'compra' | 'estimado' | 'donado';

/** DA2 — specs 1:1 (tec_equipo_specs), solo los campos que aplican según el tipo. */
export interface TecEquipoSpecs {
  equipo_id: string;
  // Computadora (laptop/desktop)
  procesador: string | null;
  ram_gb: number | null;
  ram_velocidad: string | null;
  almacenamiento_tipo: 'SSD' | 'HDD' | 'NVMe' | null;
  almacenamiento_gb: number | null;
  gpu_integrada: string | null;
  gpu_dedicada: string | null;
  gpu_memoria_gb: number | null;
  so: string | null;
  so_version: string | null;
  pantalla_pulgadas: number | null;
  resolucion: string | null;
  tactil: boolean | null;
  nombre_windows: string | null;
  usuario_windows: string | null;
  cargador_voltaje: string | null;
  cargador_amperaje: string | null;
  // Radio (walkie-talkie / radio base)
  frecuencia: string | null;
  potencia_w: number | null;
  tipo_radio: 'frecuencia' | 'celular_ptt' | null;
  sello_telserdom_radio: string | null;
  sello_telserdom_bateria: string | null;
  // Batería
  bateria_modelo: string | null;
  bateria_capacidad: number | null;
  bateria_unidad: 'mAh' | 'Wh' | null;
  bateria_voltaje: string | null;
  bateria_sello: string | null;
  // Accesorios + dron
  accesorios: string[];
  camara_specs: string | null;
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
  /** DA7 — SITUACIÓN: clave del catálogo tec_equipo_estados (texto libre validado por trigger). */
  estado: string;
  /** DA7 — CONDICIÓN: clave del catálogo tec_equipo_condiciones, independiente de la situación. */
  condicion: string;
  empleado_id: string | null;
  asignado_en: string | null;
  bodega_id: string | null;
  ubicacion: string | null; // legacy texto
  notas: string | null;
  costo: number | null;
  moneda: 'DOP' | 'USD';
  /** DA-12 — compra (precio real) | estimado (referencial) | donado. */
  costo_origen: TecCostoOrigen;
  fecha_compra: string | null;
  /** DA-12 — explícito "no se sabe", distinto de vacío (nunca capturado). */
  fecha_compra_desconocida: boolean;
  garantia_hasta: string | null;
  /** DA-12 — explícito "no se sabe". */
  garantia_desconocida: boolean;
  fotos: string[] | null;
  foto_portada: string | null;
  foto_path: string | null;
  /** DA-14 — capturas de "Información del sistema" de Windows u otra evidencia de specs. */
  fotos_specs: string[];
  // DA-02 — identificación
  service_tag: string | null;
  codigo_servicio: string | null;
  numero_parte: string | null;
  modelo_regulatorio: string | null;
  anio_fabricacion: number | null;
  codigo_anterior: string | null;
  imei: string | null;
  etiqueta_taller: string | null;
  /** DA-11 — persona que usa el equipo pero no tiene usuario/empleado en el SGC. */
  responsable_externo: string | null;
  // DA-10 — kits
  kit_padre_id: string | null;
  presente: boolean;
  // DA-06 — solo indica si hay clave guardada; el valor nunca viaja por aquí.
  tiene_clave: boolean;
  created_at: string;
  updated_at: string | null;
  // joins opcionales
  empleado?: { nombre: string; apellido: string | null; cargo: string | null } | null;
  specs?: TecEquipoSpecs | null;
}

/** DA-10 — estado calculado de un kit (derivado client-side de la lista cacheada). */
export interface TecKitEstado {
  totalComponentes: number;
  presentes: number;
  faltantes: number;
  completo: boolean;
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
  estado: string;
  condicion: string;
  notas: string | null;
  /** paths ya en storage (edición). */
  fotosExistentes: string[];
  /** capturas nuevas (blob + clave de slot). */
  fotosNuevas: { key: string; blob: Blob }[];
  /** portada: un path existente O una clave de slot nueva. */
  portadaKey: string | null;

  // DA — campos nuevos (todos opcionales; se escriben directo a tec_equipos/
  // tec_equipo_specs en el handler del outbox, mismo gate RLS que la web).
  responsableExterno: string | null;
  costoOrigen: TecCostoOrigen;
  fechaCompra: string | null;
  fechaCompraDesconocida: boolean;
  garantiaHasta: string | null;
  garantiaDesconocida: boolean;
  serviceTag: string | null;
  codigoServicio: string | null;
  numeroParte: string | null;
  modeloRegulatorio: string | null;
  anioFabricacion: number | null;
  codigoAnterior: string | null;
  imei: string | null;
  etiquetaTaller: string | null;
  /** DA-14 — fotos de "especificaciones" (separadas de la portada). */
  fotosSpecsExistentes: string[];
  fotosSpecsNuevas: { key: string; blob: Blob }[];
  /** DA2 — solo los campos del bloque que aplique según grupos_campos del tipo. */
  specs: Partial<Omit<TecEquipoSpecs, 'equipo_id'>> | null;
}
