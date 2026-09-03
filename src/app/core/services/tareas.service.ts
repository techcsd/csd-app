import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  Tarea,
  TareaPrioridad,
  TareaLinkedTipo,
  TareaLinkedParams,
} from '../models/tarea.model';

const CATALOG_TAREAS = 'mis_tareas';
const BUCKET = 'inventario';

export interface CrearTareaInput {
  titulo: string;
  descripcion: string | null;
  prioridad: TareaPrioridad;
  asignadoA: string;
  proyectoId: string | null;
  fechaLimite: string | null;
  // AG15 — vínculo dinámico opcional (tarea → conduce/ruta/mantenimiento/cronograma).
  linkedTipo?: TareaLinkedTipo | null;
  linkedParams?: TareaLinkedParams | null;
}

/** Búsqueda de usuario para asignar (reusa buscar_usuarios). */
export interface UsuarioBusqueda {
  id: string;
  nombre: string;
  email: string | null;
}

/**
 * AF39 — Tareas en la app. Lista (mis_tareas_app), avance de estado por outbox
 * (iniciar_tarea / completar_tarea, offline-first) y creación online para roles
 * con el módulo. Push al ser asignado llega vía `notificar` (per-usuario, AF7).
 */
@Injectable({ providedIn: 'root' })
export class TareasService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  /** Mis tareas (asignadas a mí o creadas por mí). Online-first + cache offline. */
  async misTareas(incluirCompletadas = false): Promise<Tarea[]> {
    const key = `${CATALOG_TAREAS}${incluirCompletadas ? '_all' : ''}`;
    const out = await this.catalog.refreshDetailed<Tarea[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_tareas_app', {
        p_incluir_completadas: incluirCompletadas,
      });
      if (error) throw new Error(error.message);
      return (data as Tarea[]) ?? [];
    });
    // BH6 — si la consulta FALLÓ y no hay nada en caché, propaga el error para que la
    // pantalla muestre "no se pudo cargar" con reintento, en vez de un falso "no tienes
    // tareas" (el bug de la tarea de Wagner: vacío y fallo se veían idénticos). Si hay
    // caché, se degrada mostrándola (offline-first).
    if (out.failed && !out.fromCache) {
      throw new Error('No pudimos cargar tus tareas. Revisa tu conexión e inténtalo de nuevo.');
    }
    return out.data ?? [];
  }

  /**
   * BH6 — TODAS las tareas (roles que asignan): gestión desde la app, para ver las
   * tareas por usuario y su estado. Gateada en el servidor (is_admin/tiene_modulo);
   * si el rol no aplica, la RPC lanza "No autorizado". Online (vista de gestión,
   * siempre fresca — no se cachea offline).
   */
  async todasTareas(incluirCompletadas = false, asignadoA: string | null = null): Promise<Tarea[]> {
    const { data, error } = await this.supabase.client.rpc('tareas_todas_app', {
      p_incluir_completadas: incluirCompletadas,
      p_asignado_a: asignadoA,
    });
    if (error) throw new Error(error.message);
    return (data as Tarea[]) ?? [];
  }

  /** Iniciar una tarea (pendiente → en progreso). Offline-first. */
  async iniciar(tareaId: string): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'tarea_app_iniciar',
      capturado_en: new Date().toISOString(),
      payload: { tarea_id: tareaId, fecha_inicio: new Date().toISOString().slice(0, 10) },
      fotos: [],
      resumen: { tipo: 'tarea_app_iniciar', tarea_id: tareaId },
    });
    await this.invalidar();
  }

  /** Completar una tarea (con justificación y foto opcionales). Offline-first. */
  async completar(tareaId: string, justificacion: string | null, foto: Blob | null): Promise<void> {
    const id = crypto.randomUUID();
    await this.sync.enqueue({
      id,
      tipo_op: 'tarea_app_completar',
      capturado_en: new Date().toISOString(),
      payload: {
        tarea_id: tareaId,
        justificacion: justificacion,
        fecha_fin: new Date().toISOString().slice(0, 10),
      },
      fotos: foto
        ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `tareas/${tareaId}/${id}.jpg`, slot: 'tarea', blob: foto }]
        : [],
      resumen: { tipo: 'tarea_app_completar', tarea_id: tareaId },
    });
    await this.invalidar();
  }

  /** Crear una tarea (roles con módulo `tareas`). Online (inserción con RLS). */
  async crear(input: CrearTareaInput): Promise<void> {
    const { data: userData } = await this.supabase.client.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) throw new Error('No autenticado');
    const { error } = await this.supabase.client.from('tareas').insert({
      titulo: input.titulo,
      descripcion: input.descripcion,
      prioridad: input.prioridad,
      asignado_a: input.asignadoA,
      asignado_por: uid,
      proyecto_id: input.proyectoId,
      fecha_limite: input.fechaLimite,
      estado: 'pendiente',
      // AG15 — vínculo dinámico (linked_id queda null hasta que se crea la entidad
      // al "Iniciar"; linked_params lleva el pre-llenado del flujo).
      linked_tipo: input.linkedTipo ?? null,
      linked_params: input.linkedParams ?? {},
    });
    if (error) throw new Error(error.message);
    await this.invalidar();
  }

  /**
   * AG15 — vincula una tarea a la entidad que se acaba de crear (p. ej. el conduce),
   * para que al completarse la entidad la tarea se cierre sola y notifique al asignador.
   * Idempotente (el backend re-sincroniza al vincular). Best-effort desde la UI: el
   * enganche fuerte vive en el handler del outbox del flujo (conduce/ruta).
   */
  async vincularEntidad(tareaId: string, tipo: TareaLinkedTipo, entityId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('vincular_tarea_entidad', {
      p_tarea_id: tareaId,
      p_tipo: tipo,
      p_entity_id: entityId,
    });
    if (error) throw new Error(error.message);
    await this.invalidar();
  }

  /** Buscar usuarios para asignar (RPC security-definer; usuarios es admin-only RLS). */
  async buscarUsuarios(term: string): Promise<UsuarioBusqueda[]> {
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: term });
    if (error) throw new Error(error.message);
    return (data as UsuarioBusqueda[]) ?? [];
  }

  private async invalidar(): Promise<void> {
    await this.catalog.invalidate(CATALOG_TAREAS);
    await this.catalog.invalidate(`${CATALOG_TAREAS}_all`);
  }

  private registerHandlers(): void {
    // QA-1 (AJ15): el módulo general sgc.tareas usa los RPC *_app y ANTES registraba
    // 'tarea_iniciar'/'tarea_completar' — las MISMAS claves que CronogramaService
    // (sgc.cronograma_tareas, RPC sin sufijo). Como `register` es last-wins, las ops
    // de un módulo se enrutaban al RPC del otro. Ahora cada flujo tiene su propia
    // clave (`tarea_app_*` vs `cronograma_tarea_*`); la retrocompatibilidad para ops
    // ya encoladas con la clave vieja vive en CronogramaService (dispatch por proyecto_id).
    this.sync.register('tarea_app_iniciar', async (payload) => {
      const { error } = await this.supabase.client.rpc('iniciar_tarea_app', {
        p_tarea_id: payload['tarea_id'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('tarea_app_completar', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('completar_tarea_app', {
        p_tarea_id: payload['tarea_id'],
        p_justificacion: payload['justificacion'] ?? null,
        p_foto_path: photoPaths['tarea'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
