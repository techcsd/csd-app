import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { SyncService, throwSyncError } from '../sync/sync.service';
import {
  ReunionAcuerdoPendiente,
  ReunionCrearInput,
  ReunionDetalle,
  ReunionFiltro,
  ReunionListado,
  ReunionTipo,
} from '../models/reunion.model';

/**
 * CP8 — Reuniones (app). Reutiliza los RPC del padre tal cual (sql/2026-10-16-
 * cp8-reuniones.sql + cp8b). Las notas van por outbox con CO16 (id creado al
 * abrir la nota) para que sobrevivan la mala señal de obra; el resto es
 * online-only (gestión: crear/listar/ver, no son capturas de campo).
 */
@Injectable({ providedIn: 'root' })
export class ReunionesService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);
  private catalog = inject(CatalogService);

  constructor() {
    this.registerHandler();
  }

  /** Obras para el picker de "Programar desde la app" (F5.3). */
  async obras(): Promise<{ id: string; nombre: string }[]> {
    const data = await this.catalog.refresh<{ id: string; nombre: string }[]>('reuniones_obras', async () => {
      const { data, error } = await this.supabase.client.rpc('directorio_proyectos');
      if (error) throw new Error(error.message);
      return ((data as { id: string; nombre: string }[]) ?? []).map((p) => ({ id: p.id, nombre: p.nombre }));
    });
    return data ?? [];
  }

  async tipos(): Promise<ReunionTipo[]> {
    const { data, error } = await this.supabase.client
      .from('reunion_tipos')
      .select('id, codigo, nombre, color, agenda_default, activo, orden')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return (data as ReunionTipo[]) ?? [];
  }

  async listado(filtro: ReunionFiltro, tipoId: string | null = null, proyectoId: string | null = null): Promise<ReunionListado[]> {
    const { data, error } = await this.supabase.client.rpc('reuniones_listado', {
      p_filtro: filtro,
      p_tipo_id: tipoId,
      p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    return (data as ReunionListado[]) ?? [];
  }

  async detalle(id: string): Promise<ReunionDetalle> {
    const { data, error } = await this.supabase.client.rpc('reunion_detalle', { p_id: id });
    if (error) throw new Error(error.message);
    return data as ReunionDetalle;
  }

  async crear(input: ReunionCrearInput): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('reunion_crear', {
      p_tipo_id: input.tipoId,
      p_titulo: input.titulo,
      p_inicio: input.inicio,
      p_fin: input.fin,
      p_modalidad: input.modalidad,
      p_lugar: input.lugar,
      p_proyecto_id: input.proyectoId,
      p_participantes_usuarios: input.participantesUsuarios,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  /** "Mis acuerdos de reuniones anteriores" — solo los MÍOS pendientes, no el arreglo completo de la ficha. */
  async acuerdosPendientesMios(): Promise<ReunionAcuerdoPendiente[]> {
    const { data, error } = await this.supabase.client.rpc('reunion_acuerdos_pendientes_mios');
    if (error) throw new Error(error.message);
    return (data as ReunionAcuerdoPendiente[]) ?? [];
  }

  /**
   * Guarda (crea/edita) MI nota de esta reunión por el outbox. CO16: el `id`
   * se crea al ABRIR la nota (lo pasa el llamador), no al enviar, para que dos
   * guardados rápidos no dupliquen nada y el estado "enviando" sea honesto.
   * `foto` (CP8c, capability) — "Foto de pizarra": sube por el mismo mecanismo
   * de fotos del outbox (igual que conduce_externo); si el padre aún no aplicó
   * cp8c, el RPC con `p_foto_path` falla y el op se reintenta solo más tarde.
   */
  async notaGuardar(reunionId: string, texto: string, foto?: Blob): Promise<void> {
    const fotos = foto
      ? [{ id: globalThis.crypto.randomUUID(), bucket: 'reuniones', path: `nota/${reunionId}/${Date.now()}-pizarra.jpg`, slot: 'pizarra', blob: foto }]
      : undefined;
    await this.sync.enqueue({
      id: `reunion-nota-${reunionId}`, // 1 nota por (reunión, usuario) — id estable, no por-envío
      tipo_op: 'reunion_nota',
      capturado_en: new Date().toISOString(),
      payload: { reunion_id: reunionId, texto },
      fotos,
      resumen: { titulo: 'Nota de reunión' },
    });
  }

  /** URL firmada (1h) de una foto de nota (bucket privado `reuniones`). Capability-safe. */
  async fotoNotaUrl(path: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage.from('reuniones').createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    } catch {
      return null;
    }
  }

  /** Usuario para el picker de participantes (reusa `buscar_usuarios`, igual que el resto de la app). */
  async buscarUsuarios(term: string): Promise<{ id: string; nombre: string; email: string | null }[]> {
    const t = term.trim();
    if (t.length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: t });
    if (error) return [];
    return (data as { id: string; nombre: string; email: string | null }[]) ?? [];
  }

  private registerHandler(): void {
    this.sync.register('reunion_nota', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('reunion_nota_guardar', {
        p_reunion_id: payload['reunion_id'],
        p_texto: payload['texto'] ?? '',
        p_foto_path: photoPaths['pizarra'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
