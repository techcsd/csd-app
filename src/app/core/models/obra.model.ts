// AG16 — Gestión de Producción de Obra (app). Tipos del módulo "Mi obra".

/** Una obra/proyecto donde el usuario puede actuar (de `mis_proyectos`). */
export interface ObraProyecto {
  id: string;
  nombre: string;
  codigo?: string | null;
  estado?: string | null;
}

/** Tarea del plan del día (de `plan_del_dia`). */
export interface PlanTarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: string;
  prioridad: string;
  brigada: string | null;
  asignado_a: string | null;
  responsable: string | null;
  avance_pct?: number | null;
  linked_tipo?: string | null;
  linked_id?: string | null;
}

/** Charla de seguridad del día (de `plan_del_dia`). */
export interface CharlaDia {
  id: string;
  tema: string | null;
  duracion_min: number | null;
  asistentes: number | null;
  fotos: string[] | null;
}

export interface PlanDelDia {
  charla: CharlaDia | null;
  tareas: PlanTarea[];
}

/** Tipos de no conformidad. */
export type NcTipo = 'calidad' | 'orden_limpieza' | 'epp' | 'seguridad';
export const NC_TIPO_META: Record<NcTipo, { label: string; icon: string }> = {
  calidad: { label: 'Calidad', icon: '🔧' },
  orden_limpieza: { label: 'Orden y limpieza', icon: '🧹' },
  epp: { label: 'EPP', icon: '🦺' },
  seguridad: { label: 'Seguridad', icon: '⚠️' },
};

export type Severidad = 'baja' | 'media' | 'alta' | 'critica';
export const SEVERIDAD_META: Record<Severidad, { label: string; tint: string }> = {
  baja: { label: 'Baja', tint: '#6b7280' },
  media: { label: 'Media', tint: '#ca8a04' },
  alta: { label: 'Alta', tint: '#ea580c' },
  critica: { label: 'Crítica', tint: '#dc2626' },
};

/** Fila de la bandeja "Mis no conformidades" (de `mis_nc_asignadas`). */
export interface NcAsignada {
  clase: 'nc' | 'accion';
  id: string;
  proyecto_id: string;
  proyecto_nombre: string | null;
  titulo: string | null;
  descripcion: string | null;
  estado: string;
  tipo: NcTipo | null;
  severidad: Severidad | null;
  ubicacion: string | null;
  fotos: string[] | null;
  fecha_compromiso: string | null;
  origen_tipo: string | null;
  origen_id: string | null;
  created_at: string;
}

/** Ítem de stock de la obra (de `stock_de_obra`). */
export interface StockObraItem {
  articulo_id: string;
  nombre: string;
  unidad: string | null;
  cantidad: number;
}

/** Plantilla de checklist de calidad (de `cl_plantillas` categoria='calidad'). */
export interface ChecklistPlantilla {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
}
export interface ChecklistItem {
  id: string;
  seccion: string | null;
  etiqueta: string;
  orden: number;
}

/** Subcontratista + sus frentes. */
export interface Subcontratista {
  id: string;
  nombre: string;
  especialidad: string | null;
  contacto: string | null;
  telefono: string | null;
  activo: boolean;
}

/** Frente de trabajo asignado a un subcontratista en una obra. */
export interface Frente {
  id: string;
  descripcion: string | null;
  avance_pct: number | null;
  elemento_id?: string | null;
  activo?: boolean;
}

/** Tarea del cronograma de la obra (con % de avance real). */
export interface CronogramaTarea {
  id: string;
  nombre: string;
  estado: string | null;
  avance_pct: number | null;
  fase_id?: string | null;
  orden?: number | null;
}

/** Resumen del día para el home de "Mi obra" (FASE 6). */
export interface ResumenObra {
  charlaHecha: boolean;
  tareasHoy: number;
  tareasPendientes: number;
  ncAbiertas: number;
  misPendientes: number;
  pedidosPendientes: number;
  avanceReal: number | null;
  avancePlan: number | null;
}

/** Entrada programada de materiales/equipos (OC con fecha_programada) — Logística. */
export interface EntradaProgramada {
  id: string;
  numero: string | null;
  proveedor: string | null;
  estado: string | null;
  fecha_programada: string | null;
  total: number | null;
}

/** Pedido de la obra para seguimiento del estado (solicitudes_material). */
export interface PedidoObra {
  id: string;
  urgencia: string | null;
  estado: string | null;
  notas: string | null;
  created_at: string;
}

// ── Inputs de captura (offline, van al outbox) ──────────────────────────────

export interface CharlaCaptura {
  proyectoId: string;
  fecha: string; // YYYY-MM-DD
  tema: string;
  duracionMin: number;
  asistentes: number | null;
  notas: string | null;
  fotos: Blob[];
  firmas: Blob[];
}

export interface NcCaptura {
  proyectoId: string;
  tipo: NcTipo;
  titulo: string;
  descripcion: string;
  severidad: Severidad;
  ubicacion: string | null;
  responsableId: string | null;
  bloqueaVaciado: boolean;
  fotos: Blob[];
}

export type IncidenteTipo = 'casi_accidente' | 'incidente' | 'accidente';
export interface IncidenteCaptura {
  proyectoId: string;
  tipo: IncidenteTipo;
  descripcion: string;
  gravedad: Severidad;
  lesionados: number;
  ubicacion: string | null;
  investigacion: string | null;
  fotos: Blob[];
}

export interface ChecklistRespuesta {
  etiqueta: string;
  seccion: string | null;
  cumple: boolean | null;
  comentario: string | null;
  orden: number;
}
export interface ChecklistCaptura {
  plantillaId: string;
  proyectoId: string;
  respuestas: ChecklistRespuesta[];
  observaciones: string | null;
  fotos: Blob[];
}

export interface CubicacionCaptura {
  subcontratistaId: string;
  proyectoId: string;
  periodoInicio: string;
  periodoFin: string;
  descripcion: string;
  monto: number;
  avancePct: number;
  soportes: Blob[];
}

export interface PruebaCampoCaptura {
  proyectoId: string;
  tipo: string;
  fecha: string;
  resultado: string | null;
  notas: string | null;
  fotos: Blob[];
}

export interface ManoObraCaptura {
  proyectoId: string;
  fecha: string;
  actividad: string;
  cantidadTrabajadores: number;
  horas: number;
  notas: string | null;
}

/** Asignar una tarea del plan del día (FASE 1). */
export interface AsignarTareaInput {
  proyectoId: string;
  titulo: string;
  descripcion: string | null;
  asignadoA: string | null;
  brigada: string | null;
  prioridad: string;
  fechaLimite: string | null;
}

/** Asignar una acción correctiva sobre una NC/incidente (FASE 2). */
export interface AccionCorrectivaInput {
  proyectoId: string;
  origenTipo: 'nc' | 'incidente';
  origenId: string;
  descripcion: string;
  responsableId: string | null;
  fechaCompromiso: string | null;
}

export interface PedidoUrgenteCaptura {
  proyectoId: string;
  notas: string;
  items: { articulo_id: string; descripcion: string; cantidad: number; unidad: string }[];
}
