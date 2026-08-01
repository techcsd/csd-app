/**
 * AC4 — Notas personales y compartidas (estilo ClickUp/Keep). Espeja
 * sgc.notas + sgc.nota_compartidos. Sin colaboración en tiempo real:
 * última edición gana (updated_at) con aviso de conflicto simple.
 */

export type NotaPermiso = 'ver' | 'editar';

export interface Nota {
  id: string;
  owner_id: string;
  titulo: string;
  contenido: string;
  color: string | null;
  pinned: boolean;
  archivada: boolean;
  created_at: string;
  updated_at: string;
  // ---- Derivados en el cliente ----
  /** true si el usuario logueado es el dueño. */
  es_mia?: boolean;
  /** true si está compartida CONMIGO (no soy el dueño). */
  compartida?: boolean;
  /** permiso efectivo del usuario logueado (dueño ⇒ 'editar'). */
  permiso?: NotaPermiso;
  /** true mientras la nota está pendiente de sincronizar (outbox). */
  enviando?: boolean;
}

/** Un usuario con acceso a una nota (para el panel de compartir del dueño). */
export interface NotaCompartido {
  usuario_id: string;
  nombre: string;
  email: string | null;
  permiso: NotaPermiso;
}

/** Resultado del buscador de usuarios (RPC sgc.buscar_usuarios). */
export interface UsuarioBusqueda {
  id: string;
  nombre: string;
  email: string | null;
}

/**
 * AD9 — un ítem de checklist estructurado de una nota (espeja
 * sgc.nota_checklist_items). Puede estar vinculado a una Tarea de la plataforma:
 * cuando la tarea se completa, `done`/`done_auto` los marca el servidor (trigger)
 * y la app solo lo muestra en solo lectura.
 */
export interface NotaChecklistItem {
  id: string;
  nota_id: string;
  orden: number;
  texto: string;
  done: boolean;
  /** true si lo marcó automáticamente una tarea vinculada (solo lectura en la app). */
  done_auto: boolean;
  /** tipo de objeto vinculado (hoy solo 'tarea'); null = ítem manual. */
  ref_tipo: 'tarea' | null;
  ref_id: string | null;
}

/** Lo que el editor persiste de un ítem manual (los vinculados no se tocan en la app). */
export interface NotaChecklistItemCaptura {
  id: string;
  orden: number;
  texto: string;
  done: boolean;
}

/** Entrada que el editor le pasa a NotasService.guardar(). */
export interface NotaCaptura {
  id: string;
  titulo: string;
  contenido: string;
  color: string | null;
  pinned: boolean;
  archivada: boolean;
  /** updated_at conocido (para detectar conflicto); null si es nueva. */
  expectedUpdatedAt: string | null;
}

/** Paleta de colores para las notas (claro; el default es sin color). */
export const NOTA_COLORES: { valor: string | null; label: string }[] = [
  { valor: null, label: 'Sin color' },
  { valor: '#fde68a', label: 'Amarillo' },
  { valor: '#bbf7d0', label: 'Verde' },
  { valor: '#bfdbfe', label: 'Azul' },
  { valor: '#fbcfe8', label: 'Rosa' },
  { valor: '#e9d5ff', label: 'Morado' },
  { valor: '#fed7aa', label: 'Naranja' },
];
