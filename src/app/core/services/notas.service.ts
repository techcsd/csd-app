import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { db } from '../db/app-db';
import { Nota, NotaCaptura, NotaCompartido, NotaPermiso, UsuarioBusqueda } from '../models/nota.model';

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
  }
}
