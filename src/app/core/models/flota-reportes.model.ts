// S22/S24 — reportes de flota desde la app (accidente, daño, multa). Contratos
// de PROMPT-9 (RPCs *_app security-definer, idempotentes por p_id).

/** Fase del accidente: en el momento del suceso o un reporte posterior. */
export type AccidenteFase = 'en_el_momento' | 'posterior';

export const ACCIDENTE_FASES: { value: AccidenteFase; label: string; icon: string }[] = [
  { value: 'en_el_momento', label: 'En el momento', icon: '🚨' },
  { value: 'posterior', label: 'Después del suceso', icon: '🕒' },
];

/** Origen de un daño (fuera de entregas). */
export type DanoOrigen = 'accidente' | 'uso' | 'desconocido';

/** Captura de "Reportar accidente" (S22). */
export interface AccidenteCaptura {
  vehiculoId: string;
  fase: AccidenteFase;
  descripcion: string;
  lesionados: number;
  tercero: string | null;
  gps: { lat: number; lng: number } | null;
  /** Acta AMET (foto o PDF), opcional. */
  amet: { blob: Blob; ext: string } | null;
}

/** Captura de "Reportar daño" (S22). */
export interface DanoCaptura {
  vehiculoId: string;
  zona: string;
  descripcion: string | null;
  origen: DanoOrigen;
  foto: Blob | null;
}

/** S32 — multa en el perfil de actividad del conductor. */
export interface FlotaMulta {
  id: string;
  fecha: string | null;
  motivo: string | null;
  monto: number | null;
  estado: string | null;
  created_at: string | null;
}

/** S32 — accidente en el perfil de actividad del conductor. */
export interface FlotaAccidente {
  id: string;
  fecha: string | null;
  fase: string | null;
  descripcion: string | null;
  lesionados: number | null;
  vehiculo?: { placa: string } | null;
}

/** S32 — entrega/recepción en el perfil de actividad. */
export interface FlotaEntrega {
  id: string;
  tipo: string; // recepcion | devolucion
  km: number | null;
  created_at: string | null;
  vehiculo?: { placa: string } | null;
}

/** S32 — desglose de checklists por tipo (pre-uso vs semanal). */
export interface ChecklistBreakdown {
  preuso: number;
  semanal: number;
}

/** V2 — un checklist (pre-uso o semanal) en el historial de "Mi actividad". */
export interface HistorialChecklist {
  id: string;
  fecha: string | null;
  tipo: string; // pre_uso | inspeccion
  resultado: string | null; // aprobado | con_hallazgos | bloqueado
  kilometraje: number | null;
  nivel_combustible: string | null;
  vehiculo?: { placa: string } | null;
}

/** V2 — una echada de combustible en el historial de "Mi actividad". */
export interface HistorialEchada {
  id: string;
  fecha: string | null;
  kilometraje: number | null;
  galones: number | null;
  monto: number | null;
  rendimiento_km_gal: number | null;
  alerta_consumo: boolean | null;
  vehiculo?: { placa: string } | null;
}

/** V3 — una ruta creada/asignada por el usuario (roles elevados). */
export interface RutaCreada {
  id: string;
  fecha: string | null;
  origen: string | null;
  destino: string | null;
  estado: string | null;
  vehiculo?: { placa: string } | null;
  conductor?: { nombre: string } | null;
}

/** V2 (follow-up) — detalle de un checklist (pre-uso o semanal) para "Mi actividad". */
export interface ChecklistRespuestaDetalle {
  etiqueta: string;
  seccion: string | null;
  es_critico: boolean;
  respuesta: string; // ok | no | na
  comentario: string | null;
  orden: number;
}
export interface ChecklistDetalle {
  id: string;
  tipo: string; // pre_uso | inspeccion
  fecha: string | null;
  resultado: string | null;
  kilometraje: number | null;
  nivel_combustible: string | null;
  observaciones: string | null;
  vehiculo?: { placa: string; marca?: string; modelo?: string } | null;
  conductor?: { nombre: string } | null;
  respuestas: ChecklistRespuestaDetalle[];
  fotos: { slot: string; url: string }[];
  firmaUrl: string | null;
}

/** V2 (follow-up) — detalle de una echada de combustible para "Mi actividad". */
export interface EchadaDetalle {
  id: string;
  fecha: string | null;
  kilometraje: number | null;
  km_anterior: number | null;
  km_recorridos: number | null;
  galones: number | null;
  monto: number | null;
  precio_por_galon: number | null;
  costo_por_km: number | null;
  rendimiento_km_gal: number | null;
  alerta_consumo: boolean | null;
  motivo_alerta: string | null;
  estacion: string | null;
  notas: string | null;
  vehiculo?: { placa: string; marca?: string } | null;
  reciboUrl: string | null;
  tableroUrl: string | null;
}

/** Captura de "Me pusieron una multa" (S24). */
export interface MultaCaptura {
  conductorId: string;
  vehiculoId: string | null;
  motivo: string;
  monto: number | null;
  estado: 'pendiente' | 'pagada';
  /** Foto/documento de la multa, opcional. */
  documento: { blob: Blob; ext: string } | null;
}
