import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { db } from '../db/app-db';
import {
  Nota,
  NotaCaptura,
  NotaChecklistItem,
  NotaChecklistItemCaptura,
  NotaCompartido,
  NotaPermiso,
  UsuarioBusqueda,
} from '../models/nota.model';

const CATALOG_NOTAS = 'notas_all';

/**
 * AC4 — Notas: personales + compartidas. Lectura directa (RLS scopea a dueño +
 * compartidos); escritura de contenido por el OUTBOX (guardar_nota, offline-first,
 * idempotente, conflicto = última edición gana con aviso). Compartir/borrar son
 * online (requieren buscar usuarios / RLS de dueño). Mirrors los demás servicios.
 */
@Injectable({ providedIn: 'root' })
export class NotasService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Mis notas + las compartidas conmigo (cache-then-network), con outbox merge. */
  async getNotas(): Promise<Nota[]> {
    const { data: userData } = await this.supabase.client.auth.getUser();
    const uid = userData.user?.id ?? '';
    const server = await this.catalog.refresh<Nota[]>(CATALOG_NOTAS, async () => {
      const { data, error } = await this.supabase.client
        .from('notas')
        .select(
          'id, owner_id, titulo, contenido, color, pinned, archivada, created_at, updated_at, ' +
            'compartidos:nota_compartidos(usuario_id, permiso)',
        )
        .order('updated_at', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data as unknown as Array<Record<string, unknown>>) ?? []).map((r) =>
        this.mapNota(r, uid),
      );
    });

    // Outbox merge: notas creadas/editadas offline aún sin sincronizar.
    const pend = await this.notasPendientes(uid);
    const byId = new Map<string, Nota>();
    for (const n of server ?? []) byId.set(n.id, n);
    for (const [id, p] of pend) {
      const base = byId.get(id);
      byId.set(id, { ...(base ?? ({} as Nota)), ...p, enviando: true });
    }
    return [...byId.values()].sort(this.ordenar);
  }

  /** Una nota por id (desde la lista combinada; funciona offline). */
  async getNota(id: string): Promise<Nota | null> {
    return (await this.getNotas()).find((n) => n.id === id) ?? null;
  }

  private mapNota(r: Record<string, unknown>, uid: string): Nota {
    const ownerId = r['owner_id'] as string;
    const esMia = ownerId === uid;
    const comp = (r['compartidos'] as Array<{ usuario_id: string; permiso: NotaPermiso }>) ?? [];
    const miShare = comp.find((c) => c.usuario_id === uid);
    return {
      id: r['id'] as string,
      owner_id: ownerId,
      titulo: (r['titulo'] as string) ?? '',
      contenido: (r['contenido'] as string) ?? '',
      color: (r['color'] as string) ?? null,
      pinned: (r['pinned'] as boolean) ?? false,
      archivada: (r['archivada'] as boolean) ?? false,
      created_at: r['created_at'] as string,
      updated_at: r['updated_at'] as string,
      es_mia: esMia,
      compartida: !esMia,
      permiso: esMia ? 'editar' : (miShare?.permiso ?? 'ver'),
    };
  }

  private ordenar(a: Nota, b: Nota): number {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
  }

  /** Notas del outbox aún sin sincronizar (para verlas al instante offline). */
  private async notasPendientes(uid: string): Promise<Map<string, Partial<Nota>>> {
    const map = new Map<string, Partial<Nota>>();
    try {
      const ops = await db.outbox.where('tipo_op').equals('nota_guardar').toArray();
      for (const op of ops) {
        const p = op.payload as Record<string, unknown>;
        map.set(p['id'] as string, {
          id: p['id'] as string,
          titulo: (p['titulo'] as string) ?? '',
          contenido: (p['contenido'] as string) ?? '',
          color: (p['color'] as string) ?? null,
          pinned: (p['pinned'] as boolean) ?? false,
          archivada: (p['archivada'] as boolean) ?? false,
          updated_at: op.capturado_en,
          owner_id: uid,
          es_mia: true,
          compartida: false,
          permiso: 'editar',
        });
      }
    } catch {
      /* sin outbox legible → solo servidor */
    }
    return map;
  }

  /** Guarda (crea/edita) una nota por el outbox. Offline-safe, idempotente. */
  async guardar(input: NotaCaptura): Promise<void> {
    await this.sync.enqueue({
      id: input.id,
      tipo_op: 'nota_guardar',
      capturado_en: new Date().toISOString(),
      payload: {
        id: input.id,
        titulo: input.titulo,
        contenido: input.contenido,
        color: input.color,
        pinned: input.pinned,
        archivada: input.archivada,
        expected_updated_at: input.expectedUpdatedAt,
      },
      resumen: { titulo: input.titulo || 'Nota' },
    });
    void this.getNotas();
  }

  /**
   * Guarda directo en el servidor (online, sin outbox). Se usa ANTES de compartir
   * porque compartir exige que la nota ya exista en el servidor (FK) — el guardado
   * normal por outbox es asíncrono y habría carrera con el insert de compartidos.
   */
  async guardarDirecto(input: NotaCaptura): Promise<void> {
    const { error } = await this.supabase.client.rpc('guardar_nota', {
      p_id: input.id,
      p_titulo: input.titulo,
      p_contenido: input.contenido,
      p_color: input.color,
      p_pinned: input.pinned,
      p_archivada: input.archivada,
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_NOTAS);
  }

  // ---- Checklist estructurado (AD9) ----------------------------------------

  /**
   * Ítems de checklist de una nota. Lee directo (RLS) y superpone el último set
   * pendiente del outbox (para verlos al instante offline). Los ítems vinculados a
   * una tarea vienen siempre del servidor (los marca el trigger, no la app).
   */
  async getChecklist(notaId: string): Promise<NotaChecklistItem[]> {
    let server: NotaChecklistItem[] = [];
    try {
      const { data, error } = await this.supabase.client
        .from('nota_checklist_items')
        .select('id, nota_id, orden, texto, done, done_auto, ref_tipo, ref_id')
        .eq('nota_id', notaId)
        .order('orden', { ascending: true });
      if (!error) server = (data as unknown as NotaChecklistItem[]) ?? [];
    } catch {
      /* offline → solo pendientes */
    }

    const pend = await this.checklistPendiente(notaId);
    if (!pend) return server.sort((a, b) => a.orden - b.orden);

    // Hay un set pendiente: los ítems manuales los manda el cliente; los
    // vinculados (ref_tipo) siguen siendo los del servidor.
    const vinculados = server.filter((i) => i.ref_tipo);
    return [...vinculados, ...pend].sort((a, b) => a.orden - b.orden);
  }

  /** Último `nota_checklist_set` pendiente en el outbox (ítems manuales). */
  private async checklistPendiente(notaId: string): Promise<NotaChecklistItem[] | null> {
    try {
      const ops = await db.outbox.where('tipo_op').equals('nota_checklist_set').toArray();
      const mine = ops
        .filter((o) => (o.payload as Record<string, unknown>)['nota_id'] === notaId)
        .sort((a, b) => (a.created_local ?? 0) - (b.created_local ?? 0));
      const last = mine.at(-1);
      if (!last) return null;
      const items = ((last.payload as Record<string, unknown>)['items'] as NotaChecklistItemCaptura[]) ?? [];
      return items.map((it) => ({
        id: it.id,
        nota_id: notaId,
        orden: it.orden,
        texto: it.texto,
        done: it.done,
        done_auto: false,
        ref_tipo: null,
        ref_id: null,
      }));
    } catch {
      return null;
    }
  }

  /**
   * Reconcilia los ítems vinculados con el estado ACTUAL de su tarea (red de
   * seguridad: "se marca solo al completarse"). Online, best-effort.
   */
  async reconciliarChecklist(notaId: string): Promise<void> {
    try {
      await this.supabase.client.rpc('sync_checklist_nota', { p_nota_id: notaId });
    } catch {
      /* offline / sin acceso → se verá el último estado conocido */
    }
  }

  /** Guarda los ítems manuales del checklist por el outbox (reemplazo idempotente). */
  async guardarChecklist(notaId: string, items: NotaChecklistItemCaptura[]): Promise<void> {
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'nota_checklist_set',
      capturado_en: new Date().toISOString(),
      payload: { nota_id: notaId, items },
    });
  }

  /** Borra una nota (solo el dueño; online — la RLS lo valida). */
  async eliminar(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('notas').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_NOTAS);
  }

  // ---- Compartir (online) --------------------------------------------------

  /** Busca usuarios registrados para compartir (RPC security-definer). */
  async buscarUsuarios(term: string): Promise<UsuarioBusqueda[]> {
    if (term.trim().length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: term });
    if (error) throw new Error(error.message);
    return (data as UsuarioBusqueda[]) ?? [];
  }

  /** Con quién está compartida una nota (resuelve nombres vía RPC). */
  async getCompartidos(notaId: string): Promise<NotaCompartido[]> {
    const { data, error } = await this.supabase.client
      .from('nota_compartidos')
      .select('usuario_id, permiso')
      .eq('nota_id', notaId);
    if (error) throw new Error(error.message);
    const shares = (data as Array<{ usuario_id: string; permiso: NotaPermiso }>) ?? [];
    if (!shares.length) return [];
    const ids = shares.map((s) => s.usuario_id);
    const { data: users } = await this.supabase.client.rpc('usuarios_por_ids', { p_ids: ids });
    const byId = new Map(
      ((users as UsuarioBusqueda[]) ?? []).map((u) => [u.id, u]),
    );
    return shares.map((s) => ({
      usuario_id: s.usuario_id,
      permiso: s.permiso,
      nombre: byId.get(s.usuario_id)?.nombre ?? 'Usuario',
      email: byId.get(s.usuario_id)?.email ?? null,
    }));
  }

  /** Comparte (o cambia el permiso) con un usuario. Solo el dueño (RLS). */
  async compartir(notaId: string, usuarioId: string, permiso: NotaPermiso): Promise<void> {
    const { data: ex } = await this.supabase.client
      .from('nota_compartidos')
      .select('id')
      .eq('nota_id', notaId)
      .eq('usuario_id', usuarioId)
      .maybeSingle();
    if (ex) {
      const { error } = await this.supabase.client
        .from('nota_compartidos')
        .update({ permiso })
        .eq('id', (ex as { id: string }).id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await this.supabase.client
        .from('nota_compartidos')
        .insert({ nota_id: notaId, usuario_id: usuarioId, permiso });
      if (error) throw new Error(error.message);
    }
    await this.catalog.invalidate(CATALOG_NOTAS);
  }

  /** Quita el acceso de un usuario. Solo el dueño (RLS). */
  async quitarCompartido(notaId: string, usuarioId: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('nota_compartidos')
      .delete()
      .eq('nota_id', notaId)
      .eq('usuario_id', usuarioId);
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CATALOG_NOTAS);
  }

  private registerHandler(): void {
    this.sync.register('nota_guardar', async (payload) => {
      const { error } = await this.supabase.client.rpc('guardar_nota', {
        p_id: payload['id'],
        p_titulo: payload['titulo'] ?? '',
        p_contenido: payload['contenido'] ?? '',
        p_color: payload['color'] ?? null,
        p_pinned: payload['pinned'] ?? null,
        p_archivada: payload['archivada'] ?? null,
        p_expected_updated_at: payload['expected_updated_at'] ?? null,
      });
      if (error) throwSyncError(error);
      // El contenido cambió en el servidor → refrescar la lista al drenar.
      await this.catalog.invalidate(CATALOG_NOTAS);
    });

    // AD9 — reemplazo idempotente de los ítems MANUALES del checklist. No toca los
    // ítems vinculados a una tarea (ref_tipo not null): esos los maneja el servidor.
    this.sync.register('nota_checklist_set', async (payload) => {
      const notaId = payload['nota_id'] as string;
      const items = (payload['items'] as NotaChecklistItemCaptura[]) ?? [];

      if (items.length) {
        const rows = items.map((it) => ({
          id: it.id,
          nota_id: notaId,
          orden: it.orden,
          texto: it.texto,
          done: it.done,
        }));
        const { error } = await this.supabase.client
          .from('nota_checklist_items')
          .upsert(rows, { onConflict: 'id' });
        if (error) throwSyncError(error);
      }

      // Borra los ítems manuales que el usuario quitó (solo ref_tipo IS NULL).
      let del = this.supabase.client
        .from('nota_checklist_items')
        .delete()
        .eq('nota_id', notaId)
        .is('ref_tipo', null);
      const keep = items.map((i) => i.id);
      if (keep.length) del = del.not('id', 'in', `(${keep.join(',')})`);
      const { error: eDel } = await del;
      if (eDel) throwSyncError(eDel);
    });
  }
}
