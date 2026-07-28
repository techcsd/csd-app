// Y14 (PROMPT-4) — Módulo Proyectos en la app (consulta). Modelo más rico que el
// `Proyecto` mínimo de bitacora.model.ts (id/nombre), para el listado + detalle.

export type ProyectoEstado =
  | 'planificacion'
  | 'en_progreso'
  | 'pausado'
  | 'completado'
  | 'cancelado';

export interface FaseProyecto {
  id: string;
  proyecto_id: string;
  nombre: string;
  descripcion: string | null;
  estado: 'pendiente' | 'en_progreso' | 'completada';
  fecha_inicio: string | null;
  fecha_fin: string | null;
  progreso: number; // 0-100
  orden: number;
}

export interface ProyectoApp {
  id: string;
  codigo: string | null;
  nombre: string;
  cliente: string | null;
  tipo: string | null;
  estado: ProyectoEstado;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  fecha_fin_real: string | null;
  ubicacion: string | null;
  localidad: string | null;
  descripcion: string | null;
  responsable?: { nombre: string } | null;
  fases: FaseProyecto[];
}

export const PROYECTO_ESTADO_LABEL: Record<ProyectoEstado, string> = {
  planificacion: 'Planificación',
  en_progreso: 'En progreso',
  pausado: 'Pausado',
  completado: 'Completado',
  cancelado: 'Cancelado',
};

export const FASE_ESTADO_LABEL: Record<FaseProyecto['estado'], string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completada: 'Completada',
};

/** Avance del proyecto = promedio del progreso de sus fases (0-100, o null). */
export function progresoProyecto(fases: FaseProyecto[]): number | null {
  if (!fases.length) return null;
  const sum = fases.reduce((a, f) => a + (Number(f.progreso) || 0), 0);
  return Math.round(sum / fases.length);
}
