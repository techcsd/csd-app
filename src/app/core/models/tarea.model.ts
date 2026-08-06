/** AF39 — una tarea del módulo Tareas (sgc.tareas), con nombres resueltos. */
export type TareaEstado = 'pendiente' | 'en_progreso' | 'completada' | 'cancelada';
export type TareaPrioridad = 'baja' | 'media' | 'alta' | 'urgente';

/** AG15 — tipos de entidad a la que una tarea puede vincularse. */
export type TareaLinkedTipo = 'conduce' | 'ruta' | 'mantenimiento' | 'cronograma';

/** AG15 — parámetros de pre-llenado del flujo vinculado (ferretería, obra, etc.). */
export interface TareaLinkedParams {
  origen_tipo?: string; // 'ferreteria' | 'almacen' | 'obra' | ...
  ferreteria_id?: string;
  bodega_id?: string;
  obra_id?: string; // proyecto destino
  vehiculo_id?: string;
  [k: string]: unknown;
}

export interface Tarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  estado: TareaEstado;
  prioridad: TareaPrioridad;
  asignado_a: string | null;
  asignado_a_nombre: string | null;
  asignado_por: string | null;
  asignado_por_nombre: string | null;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  fecha_limite: string | null;
  fecha_completada: string | null;
  created_at: string;
  // AG15 — vínculo dinámico (opcional; las tareas sin vínculo funcionan igual).
  linked_tipo?: TareaLinkedTipo | null;
  linked_id?: string | null;
  linked_params?: TareaLinkedParams | null;
  auto_completada?: boolean;
}

/** AG15 — etiqueta del vínculo para la UI (qué flujo abre "Iniciar"). */
export const TAREA_LINKED_META: Record<TareaLinkedTipo, { label: string; icon: string; cta: string }> = {
  conduce: { label: 'Conduce', icon: '📦', cta: 'Iniciar y crear el conduce' },
  ruta: { label: 'Ruta', icon: '🗺️', cta: 'Iniciar y crear la ruta' },
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', cta: 'Iniciar y registrar el mantenimiento' },
  cronograma: { label: 'Cronograma', icon: '📅', cta: 'Iniciar' },
};

export const TAREA_ESTADO_META: Record<TareaEstado, { label: string; icon: string; tone: string }> = {
  pendiente: { label: 'Pendiente', icon: '🕒', tone: '#ca8a04' },
  en_progreso: { label: 'En progreso', icon: '🔧', tone: '#2563eb' },
  completada: { label: 'Completada', icon: '✅', tone: '#16a34a' },
  cancelada: { label: 'Cancelada', icon: '🚫', tone: '#6b7280' },
};

export const TAREA_PRIORIDAD_META: Record<TareaPrioridad, { label: string; tone: string }> = {
  urgente: { label: 'Urgente', tone: '#dc2626' },
  alta: { label: 'Alta', tone: '#ea580c' },
  media: { label: 'Media', tone: '#ca8a04' },
  baja: { label: 'Baja', tone: '#6b7280' },
};
