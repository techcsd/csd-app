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
  /** Display number from the catalog (e.g. "1.1", "P2"). */
  numero: string | null;
  /** Which vehicle class the item applies to: 'Ambos' | 'Liviano' | 'Pesado'. */
  aplica_a: string;
}

// V5 — los niveles de combustible se unificaron en `NIVELES_COMBUSTIBLE`
// (transporte.model, con "E"/"F"). El pre-uso y el reporte semanal usan esa.

/**
 * The 7 mandatory guided shots for a pre-use inspection (fixed slot names the
 * server + PDF rely on). Exterior (4) + Interior (3).
 */
export const FOTOS_PREUSO = [
  { slot: 'delantera', label: 'Delantera', hint: '🚙', grupo: 'EXTERIOR' },
  { slot: 'lateral_izq', label: 'Lateral izquierda', hint: '🚙', grupo: 'EXTERIOR' },
  { slot: 'lateral_der', label: 'Lateral derecha', hint: '🚙', grupo: 'EXTERIOR' },
  { slot: 'trasera', label: 'Trasera', hint: '🚙', grupo: 'EXTERIOR' },
  { slot: 'tablero', label: 'Tablero', hint: '🎛️', grupo: 'INTERIOR' },
  { slot: 'interior_del', label: 'Interior delantero', hint: '💺', grupo: 'INTERIOR' },
  { slot: 'parte_trasera', label: 'Parte trasera', hint: '🪑', grupo: 'INTERIOR' },
] as const;

/** Pre-use verdict, mirrors sgc.checklists_vehiculo.resultado. */
export type ChecklistResultado = 'aprobado' | 'con_hallazgos' | 'bloqueado';

// P4 — la clasificación Liviano/Pesado vive en `vehiculo-tipos.model` (paridad
// con el SGC: livianos = moto/auto/suv/pickup/otro). Se re-exporta aquí para no
// romper los imports existentes (preuso, specs).
export { claseVehiculo, esVehiculoPesado } from './vehiculo-tipos.model';

/** Whether an item applies to the given vehicle class. */
export function itemAplica(item: ChecklistPlantillaItem, clase: 'Pesado' | 'Liviano'): boolean {
  return item.aplica_a === 'Ambos' || item.aplica_a === clase;
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
  /** 'preuso' (inspección diaria) | 'semanal' (reporte semanal). */
  frecuencia?: string;
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
  conductorId: string | null;
  kilometraje: number | null;
  nivelCombustible: string | null;
  observacion: string | null;
  respuestas: RespuestaCaptura[];
  /** The 7 mandatory guided shots (slot → compressed blob). */
  fotos: Record<string, Blob>;
  firma: Blob;
  /** Locally-computed verdict, kept for the offline "mis registros" summary. */
  resultado: ChecklistResultado;
}
