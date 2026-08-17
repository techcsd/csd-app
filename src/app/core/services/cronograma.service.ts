import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { SyncService, throwSyncError } from '../sync/sync.service';
import { db } from '../db/app-db';
import { CronogramaAviso, CronogramaData, CronogramaTarea } from '../models/cronograma.model';

const BUCKET = 'sgc-cronograma';
const CAT_PREFIX = 'cronograma_'; // + proyectoId

/** Acción del outbox pendiente sobre una tarea (para el marcado optimista). */
export type TareaAccionPendiente = 'iniciar' | 'completar';

/**
 * Y15 (PROMPT-4) — Cronograma en la app. Lectura por `listar_cronograma`
 * (cache-then-network) y **toda escritura por el outbox** llamando los RPCs
 * idempotentes del contrato PROMPT-3 (`iniciar_tarea`, `completar_tarea`,
 * `enlazar_bitacora_tarea`). La foto de evidencia va al bucket privado
 * `sgc-cronograma` por el pipeline de fotos del outbox. Sin infra paralela.
 */
@Injectable({ providedIn: 'root' })
export class CronogramaService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  /** Cronograma del proyecto (tareas + recálculos), cache-then-network. */
  async listar(proyectoId: string): Promise<CronogramaData> {
    const data = await this.catalog.refresh<CronogramaData>(`${CAT_PREFIX}${proyectoId}`, async () => {
      const { data, error } = await this.supabase.client.rpc('listar_cronograma', {
        p_proyecto_id: proyectoId,
      });
      if (error) throw new Error(error.message);
      const d = (data ?? { tareas: [], recalculos: [] }) as CronogramaData;
      return { tareas: d.tareas ?? [], recalculos: d.recalculos ?? [] };
    });
    return data ?? { tareas: [], recalculos: [] };
  }

  /**
   * Y15 (FASE 5) — bandeja de avisos de cronograma pendientes (por iniciar/vencer/
   * atrasada). La RLS de `avisos_proyecto` scopea a admin/módulo proyectos. Online.
   * NOTA: no hay push ni realtime en la app (gap documentado); esto es la bandeja
   * in-app + el badge del tile.
   */
  async getAvisos(): Promise<CronogramaAviso[]> {
    const { data, error } = await this.supabase.client
      .from('avisos_proyecto')
      .select('id, tipo, proyecto_id, referencia_id, mensaje, severidad, created_at, proyecto:proyectos(nombre)')
      .eq('estado', 'pendiente')
      .like('tipo', 'cronograma_%')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) return [];
    // AS24 #3 — el embed to-one de PostgREST puede venir como arreglo de 1 elemento;
    // normalizamos a objeto para que el nombre del proyecto sí se pinte.
    return ((data as Array<Record<string, unknown>>) ?? []).map((r) => {
      const p = r['proyecto'];
      return { ...r, proyecto: Array.isArray(p) ? (p[0] ?? null) : (p ?? null) } as unknown as CronogramaAviso;
    });
  }

  /** ¿El usuario puede gestionar (iniciar/completar) el cronograma? Autoritativo
   *  (admin/módulo proyectos/responsable). Se usa para gatear las acciones sin
   *  rebote optimista. Offline → false (no se pueden validar permisos sin señal). */
  async puedeGestionar(proyectoId: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('puede_gestionar_cronograma', {
      p_proyecto_id: proyectoId,
    });
    if (error) return false;
    return data === true;
  }

  /** URL firmada de la foto de evidencia (bucket privado). null si falla. */
  async getEvidenciaUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  // ─── Marcado optimista (reconciliación con el outbox) ────────────────────

  /**
   * Acciones de tarea aún en la cola (tareaId → 'iniciar'|'completar'), para que
   * la vista muestre "Enviando…"/estado nuevo sin esperar el drain ni "rebotar".
   * `completar` gana sobre `iniciar` si ambas estuvieran encoladas.
   */
  async accionesPendientes(): Promise<Map<string, TareaAccionPendiente>> {
    const ops = await db.outbox.where('estado').anyOf('pending', 'syncing', 'error').toArray();
    const out = new Map<string, TareaAccionPendiente>();
    for (const op of ops) {
      const p = op.payload as Record<string, unknown>;
      const tareaId = p['tarea_id'];
      if (typeof tareaId !== 'string') continue;
      // QA-1: acepta la clave nueva `cronograma_tarea_*` y la vieja `tarea_*`
      // (ops encoladas antes del split) — keyeado por tarea_id, así que no confunde
      // con tareas del módulo general.
      const completar = op.tipo_op === 'cronograma_tarea_completar' || op.tipo_op === 'tarea_completar';
      const iniciar = op.tipo_op === 'cronograma_tarea_iniciar' || op.tipo_op === 'tarea_iniciar';
      if (completar) out.set(tareaId, 'completar');
      else if (iniciar && out.get(tareaId) !== 'completar') out.set(tareaId, 'iniciar');
    }
    return out;
  }

  /** Estado efectivo = estado del servidor reflejando la op pendiente. */
  estadoEfectivo(tarea: CronogramaTarea, pend?: TareaAccionPendiente): CronogramaTarea['estado'] {
    if (pend === 'completar') return 'completada';
    if (pend === 'iniciar' && tarea.estado === 'pendiente') return 'en_curso';
    return tarea.estado;
  }

  // ─── Escrituras (outbox) ─────────────────────────────────────────────────

  /** Iniciar una tarea (pendiente → en_curso). Offline-first. */
  async enqueueIniciar(tareaId: string, proyectoId: string): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'cronograma_tarea_iniciar',
      capturado_en,
      payload: { id, tarea_id: tareaId, proyecto_id: proyectoId, fecha: capturado_en.slice(0, 10) },
    });
  }

  /**
   * Completar una tarea. Exige foto de evidencia; si la tarea está atrasada,
   * exige justificación (el RPC también lo valida). La foto sube a
   * `sgc-cronograma` y se pasa como `p_foto_path`; `p_fecha_fin` = fecha de
   * captura (correcta aunque se sincronice días después, offline).
   */
  async enqueueCompletar(input: {
    tareaId: string;
    proyectoId: string;
    fotoEvidencia: Blob;
    justificacion?: string | null;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'cronograma_tarea_completar',
      capturado_en,
      payload: {
        id,
        tarea_id: input.tareaId,
        proyecto_id: input.proyectoId,
        justificacion: input.justificacion?.trim() || null,
        fecha: capturado_en.slice(0, 10),
      },
      fotos: [
        { id: crypto.randomUUID(), bucket: BUCKET, path: `${input.tareaId}/${id}.jpg`, slot: 'evidencia', blob: input.fotoEvidencia },
      ],
    });
  }

  /**
   * Y15.8 — enlazar una bitácora a una tarea (evidencia). Si `completar`,
   * dispara `completar_tarea` con la foto adjunta. El handler espera a que la
   * bitácora se haya sincronizado (guarda de dependencia por su client-UUID).
   */
  async enqueueEnlazar(input: {
    tareaId: string;
    bitacoraId: string;
    proyectoId: string;
    completar: boolean;
    fotoEvidencia?: Blob | null;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.completar && input.fotoEvidencia
      ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `${input.tareaId}/${id}.jpg`, slot: 'evidencia', blob: input.fotoEvidencia }]
      : [];
    await this.sync.enqueue({
      id,
      tipo_op: 'tarea_enlazar',
      capturado_en,
      payload: { id, tarea_id: input.tareaId, bitacora_id: input.bitacoraId, proyecto_id: input.proyectoId, completar: input.completar },
      fotos,
    });
  }

  private registerHandlers(): void {
    // QA-1 (AJ15): estos son los RPC de sgc.cronograma_tareas. Antes se registraban
    // como 'tarea_iniciar'/'tarea_completar', colisionando con el módulo general de
    // Tareas (TareasService, RPC *_app). Ahora usan claves propias `cronograma_*`.
    this.sync.register('cronograma_tarea_iniciar', async (payload) => {
      const { error } = await this.supabase.client.rpc('iniciar_tarea', {
        p_tarea_id: payload['tarea_id'],
        p_fecha_inicio: payload['fecha'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(`${CAT_PREFIX}${payload['proyecto_id']}`);
    });

    this.sync.register('cronograma_tarea_completar', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('completar_tarea', {
        p_tarea_id: payload['tarea_id'],
        p_foto_path: photoPaths['evidencia'] ?? null,
        p_justificacion: payload['justificacion'] ?? null,
        p_fecha_fin: payload['fecha'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(`${CAT_PREFIX}${payload['proyecto_id']}`);
    });

    // QA-1 retrocompatibilidad: ops ya encoladas (≤1.68.0) usan la clave ambigua
    // 'tarea_iniciar'/'tarea_completar'. CronogramaService se instancia al arranque
    // (app.config) así que estos handlers siempre están presentes; se enruta por
    // `proyecto_id` (las ops de cronograma lo llevan; las de Tareas general no) y por
    // el slot de foto (`evidencia` vs `tarea`). Quitar tras drenar la flota (≥2 versiones).
    this.sync.register('tarea_iniciar', async (payload) => {
      if (payload['proyecto_id']) {
        const { error } = await this.supabase.client.rpc('iniciar_tarea', {
          p_tarea_id: payload['tarea_id'],
          p_fecha_inicio: payload['fecha'] ?? null,
        });
        if (error) throwSyncError(error);
        await this.catalog.invalidate(`${CAT_PREFIX}${payload['proyecto_id']}`);
      } else {
        const { error } = await this.supabase.client.rpc('iniciar_tarea_app', {
          p_tarea_id: payload['tarea_id'],
        });
        if (error) throwSyncError(error);
      }
    });

    this.sync.register('tarea_completar', async (payload, photoPaths) => {
      if (payload['proyecto_id']) {
        const { error } = await this.supabase.client.rpc('completar_tarea', {
          p_tarea_id: payload['tarea_id'],
          p_foto_path: photoPaths['evidencia'] ?? null,
          p_justificacion: payload['justificacion'] ?? null,
          p_fecha_fin: payload['fecha'] ?? null,
        });
        if (error) throwSyncError(error);
        await this.catalog.invalidate(`${CAT_PREFIX}${payload['proyecto_id']}`);
      } else {
        const { error } = await this.supabase.client.rpc('completar_tarea_app', {
          p_tarea_id: payload['tarea_id'],
          p_justificacion: payload['justificacion'] ?? null,
          p_foto_path: photoPaths['tarea'] ?? photoPaths['evidencia'] ?? null,
        });
        if (error) throwSyncError(error);
      }
    });

    this.sync.register('tarea_enlazar', async (payload, photoPaths) => {
      // Guarda de dependencia: no enlazar hasta que la bitácora se haya enviado
      // (su op del outbox usa el mismo id). Si sigue en cola, reintentar luego.
      const bitacoraId = payload['bitacora_id'] as string;
      const parteOp = await db.outbox.get(bitacoraId);
      if (parteOp) throw new Error('Esperando que la bitácora se sincronice…'); // transitorio
      const { error } = await this.supabase.client.rpc('enlazar_bitacora_tarea', {
        p_tarea_id: payload['tarea_id'],
        p_bitacora_id: bitacoraId,
        p_completar: payload['completar'] ?? false,
        p_foto_path: photoPaths['evidencia'] ?? null,
      });
      if (error) throwSyncError(error);
      await this.catalog.invalidate(`${CAT_PREFIX}${payload['proyecto_id']}`);
    });
  }
}
