/** A pre-use vehicle inspection answer for a single checklist item. */
export type RespuestaValor = 'ok' | 'no' | 'na';

/** OK / NO / N/A choices, with the option-button tone each one should show. */
export const RESPUESTA_OPCIONES: ReadonlyArray<{
  valor: RespuestaValor;
  label: string;
  icon: string;
  tone: 'default' | 'success' | 'warning' | 'error';
}> = [
  { valor: 'ok', label: 'OK', icon: '✅', tone: 'success' },
  { valor: 'no', label: 'Falla', icon: '⚠️', tone: 'error' },
  { valor: 'na', label: 'N/A', icon: '➖', tone: 'default' },
] as const;

/** A single item of a checklist template (one thing to inspect). */
export interface ChecklistPlantillaItem {
  id: string;
  plantilla_id: string;
  seccion: string;
  etiqueta: string;
  es_critico: boolean;
  orden: number;
}

/** A checklist template (grouped set of items) — e.g. liviano / camion / general. */
export interface ChecklistPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string;
  descripcion: string | null;
  activo: boolean;
  orden: number;
  items: ChecklistPlantillaItem[];
}

/** One answered item, ready to enqueue (photo blob held until sync). */
export interface RespuestaCaptura {
  etiqueta: string;
  seccion: string;
  es_critico: boolean;
  respuesta: RespuestaValor;
  comentario: string | null;
  orden: number;
  /** Optional evidence photo blob (usually only for a 'no' answer). */
  blob?: Blob | null;
}

/** Input the pre-use wizard hands to enqueueChecklist(). */
export interface ChecklistCaptura {
  vehiculoId: string;
  plantillaId: string;
  plantilla: string;
  placa: string;
  fecha: string;
  kilometraje: number | null;
  observacion: string | null;
  respuestas: RespuestaCaptura[];
  firma: Blob;
}
