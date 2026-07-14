import { RespuestaCaptura } from './checklist-preuso.model';

/** One vehicle's weekly-report status for the current ISO week (R3). */
export interface ReporteSemanalVeh {
  vehiculo_id: string;
  placa: string;
  tiene_reporte: boolean;
  reporte_fecha: string | null;
  resultado: string | null;
  semana_inicio: string;
  semana_fin: string;
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
  /** Locally-computed verdict for the offline "mis registros" summary. */
  resultado: 'aprobado' | 'con_hallazgos' | 'bloqueado';
}
