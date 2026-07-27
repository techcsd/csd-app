import { RespuestaCaptura } from './checklist-preuso.model';

/** Z11 — una foto guiada del reporte semanal, con su sección (Exterior/Interior). */
export interface FotoSlotSemanal {
  slot: string;
  label: string;
  hint: string;
  seccion: string; // 'Exterior' | 'Interior'
}

/** Z11 — fallback de las fotos del semanal (mismo seed de checklist_foto_slots)
 *  para el primer arranque sin señal. */
export const FOTOS_SEMANAL_FALLBACK: FotoSlotSemanal[] = [
  { slot: 'ext_delantera', label: 'Exterior — vista delantera', hint: '🚙', seccion: 'Exterior' },
  { slot: 'ext_trasera', label: 'Exterior — vista trasera', hint: '🚙', seccion: 'Exterior' },
  { slot: 'ext_lateral_izq', label: 'Exterior — lateral izquierdo', hint: '🚙', seccion: 'Exterior' },
  { slot: 'ext_lateral_der', label: 'Exterior — lateral derecho', hint: '🚙', seccion: 'Exterior' },
  { slot: 'int_asientos_del', label: 'Interior — asientos delanteros', hint: '💺', seccion: 'Interior' },
  { slot: 'int_asientos_tras', label: 'Interior — asientos traseros / baúl', hint: '🪑', seccion: 'Interior' },
];

/** One vehicle's weekly-report status for the current ISO week (R3). */
export interface ReporteSemanalVeh {
  vehiculo_id: string;
  placa: string;
  tiene_reporte: boolean;
  reporte_fecha: string | null;
  resultado: string | null;
  semana_inicio: string;
  semana_fin: string;
  // Z13 — estado GLOBAL del reporte de la semana (lo haya hecho quien sea).
  reportado_por?: string | null;
  reportado_por_id?: string | null;
  reportado_at?: string | null;
  km_reporte?: number | null;
}

/** Input the weekly-report wizard hands to enqueue(). */
export interface ReporteSemanalCaptura {
  vehiculoId: string;
  placa: string;
  plantillaId: string;
  conductorId: string | null;
  fecha: string;
  kilometraje: number | null;
  nivelCombustible: string | null;
  observacion: string | null;
  respuestas: RespuestaCaptura[];
  // S26a — el semanal ahora pide lo mismo que el pre-uso: fotos guiadas + firma.
  fotos: Record<string, Blob>;
  firma: Blob | null;
  // Z23 — notas de voz múltiples (opcional).
  voces?: Blob[];
  /** Locally-computed verdict for the offline "mis registros" summary. */
  resultado: 'aprobado' | 'con_hallazgos' | 'bloqueado';
}
