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
  presupuesto: number | null;
  // AM7 — ubicación estructurada (pin/link Maps/coordenadas).
  latitud: number | null;
  longitud: number | null;
  direccion_geo: string | null;
  ubicacion_metodo: string | null;
  // AM10 — data de obra que antes vivía embutida en la descripción.
  ingeniero_obra: string | null;
  maestro_encargado: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  responsable_id?: string | null;
  responsable?: { nombre: string } | null;
  fases: FaseProyecto[];
}

/** AM9 — responsable/miembro del equipo de una obra (responsables_de_proyecto). */
export interface ResponsableProyecto {
  id: string;
  usuario_id: string;
  nombre: string;
  email: string | null;
  tipo_responsabilidad: string | null;
  activo: boolean;
  desde: string | null;
  hasta: string | null;
  notas: string | null;
}

/** AM9 — payload para crear/editar un proyecto desde la app. */
export interface ProyectoInput {
  nombre: string;
  cliente: string | null;
  tipo: string | null;
  estado: ProyectoEstado;
  fecha_inicio: string | null;
  fecha_fin_estimada: string | null;
  presupuesto: number | null;
  descripcion: string | null;
  ingeniero_obra: string | null;
  maestro_encargado: string | null;
  contacto_nombre: string | null;
  contacto_telefono: string | null;
  responsable_id: string | null;
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
