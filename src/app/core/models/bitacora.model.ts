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
}

export interface Proyecto {
  id: string;
  nombre: string;
}

/** A parte captured for the local "Mis partes" list. */
export interface ParteResumen {
  id: string;
  tipo: string;
  proyecto: string;
  fecha: string;
  capturado_en: string;
}
