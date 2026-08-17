// Y15 (PROMPT-4) — Cronograma de Proyectos en la app. Mismo contrato que la web
// (docs/cronograma-diseno.md §15): la app llama los RPCs vía outbox, sin infra
// paralela. "atrasada" = condición derivada (no un cuarto estado).

export type CronogramaTipo = 'ordinaria' | 'importante' | 'critica';
export type CronogramaEstado = 'pendiente' | 'en_curso' | 'completada';

/** Fila de `sgc.cronograma_tareas` (tal como la devuelve `listar_cronograma`). */
export interface CronogramaTarea {
  id: string;
  proyecto_id: string;
  fase_id: string | null;
  nombre: string;
  descripcion: string | null;
  tipo: CronogramaTipo;
  orden: number;
  duracion_dias_plan: number;
  fecha_inicio_plan: string | null;
  fecha_fin_plan: string | null;
  fecha_inicio_real: string | null;
  fecha_fin_real: string | null;
  estado: CronogramaEstado;
  justificacion_retraso: string | null;
  foto_evidencia_path: string | null;
  iniciada_por: string | null;
  completada_por: string | null;
  es_prueba: boolean;
  created_at: string;
  updated_at: string;
  // AS21 — campos del import de Excel (los devuelve listar_cronograma vía to_jsonb).
  responsable?: string | null;
  volumetria?: string | null;
  avance_pct?: number | null;
  rendimiento?: string | null;
  grupo?: string | null;
}

/** Fila del historial de recálculos (auto-ajuste del timeline). */
export interface CronogramaRecalculo {
  id: string;
  proyecto_id: string;
  tarea_origen_id: string | null;
  tarea_destino_id: string | null;
  dias_movidos: number;
  motivo: 'adelanto_dona_critica' | 'holgura_general' | 'retraso_empuje';
  detalle: Record<string, unknown>;
  creado_por: string | null;
  created_at: string;
}

export interface CronogramaData {
  tareas: CronogramaTarea[];
  recalculos: CronogramaRecalculo[];
}

export const CRONOGRAMA_TIPOS: { value: CronogramaTipo; label: string }[] = [
  { value: 'ordinaria', label: 'Ordinaria' },
  { value: 'importante', label: 'Importante' },
  { value: 'critica', label: 'Crítica' },
];

export const CRONOGRAMA_TIPO_LABEL: Record<CronogramaTipo, string> = {
  ordinaria: 'Ordinaria',
  importante: 'Importante',
  critica: 'Crítica',
};

export const CRONOGRAMA_ESTADO_LABEL: Record<CronogramaEstado, string> = {
  pendiente: 'Pendiente',
  en_curso: 'En curso',
  completada: 'Completada',
};

export const CRONOGRAMA_MOTIVOS: Record<CronogramaRecalculo['motivo'], string> = {
  adelanto_dona_critica: 'Adelanto: días donados a una tarea importante/crítica',
  holgura_general: 'Adelanto: días como holgura general',
  retraso_empuje: 'Retraso: empujó las tareas siguientes',
};

/** Una tarea está "atrasada" si no está completada y su fin plan ya pasó. */
export function esTareaAtrasada(t: CronogramaTarea, hoyIso: string): boolean {
  return t.estado !== 'completada' && !!t.fecha_fin_plan && t.fecha_fin_plan < hoyIso;
}

/** Aviso de cronograma (avisos_proyecto tipo cronograma_*) para la bandeja app. */
export interface CronogramaAviso {
  id: string;
  tipo: string; // cronograma_por_iniciar | cronograma_por_vencer | cronograma_atrasada
  proyecto_id: string;
  referencia_id: string | null; // tarea_id (deep-link)
  mensaje: string | null;
  severidad: string | null;
  created_at: string;
  proyecto?: { nombre: string } | null;
}

export const CRONOGRAMA_AVISO_LABEL: Record<string, string> = {
  cronograma_por_iniciar: 'Por iniciar',
  cronograma_por_vencer: 'Por vencer',
  cronograma_atrasada: 'Atrasada',
};
