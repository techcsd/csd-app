// Catalog values mirror the CHECK constraints on sgc.bitacora_* — the app must
// send exactly these strings.

export const ESTRUCTURAS = [
  'COLUMNAS',
  'MUROS',
  'VIGAS',
  'LOSAS',
  'ZAPATAS/PLATEA',
  'VIGAS RIOSTRAS',
] as const;

export const ACTIVIDADES = [
  'TOPOGRAFIA',
  'CEPOS',
  'ENCOFRADO',
  'ARMADO',
  'LIBERACION MIVED',
  'TERMINACIONES DE ENCOFRADO/ARMADO',
  'VACIADO',
  'DESENCOFRADO',
] as const;

// U11 — 'CLIMA' se quitó: el clima ya se pregunta al inicio del wizard (lluvia).
// (En la BD el catálogo 'restriccion'='CLIMA' quedó desactivado; las bitácoras
// viejas que lo tengan se siguen visualizando.)
export const RESTRICCIONES = [
  'NINGUNA',
  'FALTA DE MATERIALES',
  'FALTA DE EQUIPOS/HERRAMIENTAS',
  'INTERFERENCIA DE OTRAS BRIGADAS',
  'FALTA DE LIBERACION PARA INICIO DE TRABAJOS',
  'FALTA DEL CLIENTE',
  'OTRO',
] as const;

export const INCIDENTE_TIPOS = [
  { value: 'incidente', label: 'Incidente', icon: '⚠️' },
  { value: 'accidente', label: 'Accidente', icon: '🚑' },
] as const;

export const INCIDENTE_GRAVEDADES = [
  { value: 'leve', label: 'Leve' },
  { value: 'moderado', label: 'Moderado' },
  { value: 'grave', label: 'Grave' },
  { value: 'critico', label: 'Crítico' },
] as const;

export interface ActividadEntry {
  estructura: string;
  actividad: string;
  /** How many were done (R24). Optional; unit comes from proyecto_partidas. */
  cantidad?: number | null;
}

/** W2 — un equipo alquilado en uso en la obra hoy. */
export interface EquipoAlquilado {
  equipo: string;
  uso: string | null;
  proveedor: string | null;
}

/** A planned line item for a project (R24), shown as reference in the wizard. */
export interface ProyectoPartida {
  id: string;
  nombre: string;
  unidad: string | null;
  cantidad_planeada: number;
  cantidad_ejecutada: number;
}

export interface Proyecto {
  id: string;
  nombre: string;
  /** U22 — coordenadas de la obra (para destino de rutas), si están cargadas. */
  latitud?: number | null;
  longitud?: number | null;
}

/** A bitácora with its children, for the "Mis bitácoras" list + detail. */
export interface BitacoraFull {
  id: string;
  fecha: string;
  created_at?: string | null;
  tipo: string;
  comentarios: string | null;
  // W3 — paridad con la web (parte diario).
  bloque_entrepiso?: string | null;
  ingeniero_responsable?: string | null;
  hora_fin_trabajo?: string | null;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  incidente_tipo: string | null;
  incidente_gravedad: string | null;
  incidente_subcontratista?: string | null;
  incidente_lesionados: number | null;
  incidente_descripcion: string | null;
  incidente_acciones?: string | null;
  // U13 — clima + migración (datos, no incidente).
  llovio?: boolean | null;
  lluvia_detalle?: string | null;
  hubo_migracion?: boolean | null;
  migracion_obreros?: unknown;
  // W2 — equipos alquilados en uso.
  hubo_equipos_alquilados?: boolean | null;
  proyecto?: { nombre: string } | null;
  actividades?: { estructura: string; actividad: string; cantidad?: number | null }[];
  restricciones?: { tipo_restriccion: string; descripcion_otro: string | null }[];
  equipos?: EquipoAlquilado[];
  archivos?: { nombre: string; url: string; tipo_mime: string | null }[];
}
