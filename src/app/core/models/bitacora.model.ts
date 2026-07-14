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

export const RESTRICCIONES = [
  'NINGUNA',
  'FALTA DE MATERIALES',
  'FALTA DE EQUIPOS/HERRAMIENTAS',
  'INTERFERENCIA DE OTRAS BRIGADAS',
  'FALTA DE LIBERACION PARA INICIO DE TRABAJOS',
  'FALTA DEL CLIENTE',
  'CLIMA',
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
}

/** A bitácora with its children, for the "Mis bitácoras" list + detail. */
export interface BitacoraFull {
  id: string;
  fecha: string;
  tipo: string;
  comentarios: string | null;
  personal_carpinteria: number;
  personal_acero: number;
  trabajadores_casa: number;
  otro_personal: string | null;
  incidente_tipo: string | null;
  incidente_gravedad: string | null;
  incidente_lesionados: number | null;
  incidente_descripcion: string | null;
  proyecto?: { nombre: string } | null;
  actividades?: { estructura: string; actividad: string }[];
  restricciones?: { tipo_restriccion: string; descripcion_otro: string | null }[];
  archivos?: { nombre: string; url: string; tipo_mime: string | null }[];
}
