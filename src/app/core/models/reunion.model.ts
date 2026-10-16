// CP8 — Reuniones + notas + acuerdos→tareas. Espeja los RPCs de SGC
// (sql/2026-10-16-cp8-reuniones.sql + cp8b-reuniones-compa-tools.sql).

export type ReunionModalidad = 'presencial' | 'meet' | 'mixta';
export type ReunionEstado = 'programada' | 'en_curso' | 'acta_borrador' | 'acta_aprobada' | 'cancelada';
export type ReunionFiltro = 'proximas' | 'acta_pendiente' | 'pasadas' | 'mias';

export interface ReunionTipo {
  id: string;
  codigo: string;
  nombre: string;
  color: string;
  agenda_default: string[];
  activo: boolean;
  orden: number;
}

/** Fila de `reuniones_listado`. */
export interface ReunionListado {
  id: string;
  tipo_codigo: string;
  tipo_nombre: string;
  tipo_color: string;
  titulo: string;
  inicio: string;
  fin: string;
  modalidad: ReunionModalidad;
  lugar: string | null;
  enlace: string | null;
  proyecto_id: string | null;
  proyecto_nombre: string | null;
  organizador_id: string;
  organizador_nombre: string;
  estado: ReunionEstado;
  fireflies_id: string | null;
  participantes_n: number;
  acuerdos_n: number;
  acta_lista: boolean;
}

export interface ReunionParticipante {
  id: string;
  usuario_id: string | null;
  nombre: string | null;
  correo_externo: string | null;
  asistio: boolean | null;
}

export interface ReunionAgendaItem {
  id: string;
  orden: number;
  texto: string;
}

export interface ReunionNota {
  id: string;
  usuario_id: string;
  usuario_nombre: string;
  texto: string;
  /** CP8c — "Foto de pizarra" (capability: null hasta que el padre aplique cp8c). */
  foto_path: string | null;
  es_mia: boolean;
}

export interface ReunionAcuerdo {
  id: string;
  texto: string;
  responsable_id: string | null;
  responsable_nombre: string | null;
  fecha: string | null;
  tarea_id: string | null;
}

export interface ReunionActa {
  id: string;
  reunion_id: string;
  resumen: string | null;
  version: number;
  aprobada_por: string | null;
  aprobada_at: string | null;
  enviada_at: string | null;
}

/** `reunion_detalle(p_id)` — una sola llamada para toda la ficha. */
export interface ReunionDetalle {
  reunion: ReunionListado & { lugar: string | null; enlace: string | null };
  participantes: ReunionParticipante[];
  agenda: ReunionAgendaItem[];
  notas: ReunionNota[];
  acuerdos: ReunionAcuerdo[];
  acta: ReunionActa | null;
}

/** `reunion_acuerdos_pendientes_mios()` — "Mis acuerdos de reuniones anteriores". */
export interface ReunionAcuerdoPendiente {
  id: string;
  texto: string;
  fecha: string | null;
  reunion_id: string;
  reunion_titulo: string;
  reunion_inicio: string;
  tarea_id: string | null;
}

/** Programar desde la app (versión corta — F5.3). */
export interface ReunionCrearInput {
  tipoId: string;
  titulo: string;
  inicio: string;
  fin: string;
  modalidad: ReunionModalidad;
  lugar: string | null;
  proyectoId: string | null;
  participantesUsuarios: string[];
}

export const MODALIDAD_LABEL: Record<ReunionModalidad, string> = {
  presencial: 'Presencial',
  meet: 'Google Meet',
  mixta: 'Mixta',
};

export const ESTADO_REUNION_LABEL: Record<ReunionEstado, string> = {
  programada: 'Programada',
  en_curso: 'En curso',
  acta_borrador: 'Acta en borrador',
  acta_aprobada: 'Acta aprobada',
  cancelada: 'Cancelada',
};
