import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { db } from '../db/app-db';
import { DocCaptura, DocEntidad, Documento } from '../models/documento.model';

/** X1 — bucket for conductor/vehicle documents (the SGC-created one). */
const BUCKET = 'flota-documentos';
const TIPO_OP = 'documento_upload';
const CATALOG_DOCS = 'documentos'; // + `:${entidad}:${id}`

/**
 * Documentos de conductores y vehículos (X1). Reads go through the catalog
 * cache (offline-friendly, signed URLs resolved on demand online); uploads are
 * enqueued in the outbox (compressed images / PDF as-is) and committed to the
 * `sgc.documentos` table by the registered handler when there's signal. The
 * table + `flota-documentos` bucket are gated to the flota module (same as web).
 */
@Injectable({ providedIn: 'root' })
export class DocumentosService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Documents for an entity, cached so the list survives offline. */
  async getDocumentos(entidad: DocEntidad, entidadId: string): Promise<Documento[]> {
    if (!entidadId) return [];
    const data = await this.catalog.refresh<Documento[]>(
      `${CATALOG_DOCS}:${entidad}:${entidadId}`,
      async () => {
        const { data, error } = await this.supabase.client
          .from('documentos')
          .select('id, entidad, entidad_id, tipo, nombre, path, created_at')
          .eq('entidad', entidad)
          .eq('entidad_id', entidadId)
          .order('created_at', { ascending: false });
        if (error) throw new Error(error.message);
        return (data as Documento[]) ?? [];
      },
    );
    return data ?? [];
  }

  /** Signed URL to view/download a document (online only). */
  async getSignedUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /** Doc types already queued (pending/syncing/error) for this entity, so the
   *  UI stops nagging as soon as a doc is captured — even before it syncs. */
  async tiposEnCola(entidad: DocEntidad, entidadId: string): Promise<string[]> {
    const ops = await db.outbox.where('estado').anyOf('pending', 'syncing', 'error').toArray();
    return ops
      .filter(
        (o) =>
          o.tipo_op === TIPO_OP &&
          o.payload['entidad'] === entidad &&
          o.payload['entidad_id'] === entidadId,
      )
      .map((o) => o.payload['tipo'] as string);
  }

  /**
   * Queue a document upload. Works fully offline: the blob is stored in the
   * outbox and uploaded to `flota-documentos/{entidad}/{id}/{tipo}_{uuid}.{ext}`
   * when online, then a row is inserted in `sgc.documentos`. Idempotent via the
   * client UUID (same id reused as the documento PK → upsert on re-send).
   */
  async enqueueDocumento(input: {
    entidad: DocEntidad;
    entidadId: string;
    tipo: string;
    doc: DocCaptura;
  }): Promise<void> {
    const id = crypto.randomUUID();
    const path = `${input.entidad}/${input.entidadId}/${input.tipo}_${id}.${input.doc.ext}`;
    await this.sync.enqueue({
      id,
      tipo_op: TIPO_OP,
      payload: {
        id,
        entidad: input.entidad,
        entidad_id: input.entidadId,
        tipo: input.tipo,
        nombre: input.doc.nombre,
      },
      fotos: [{ id: crypto.randomUUID(), bucket: BUCKET, path, slot: 'documento', blob: input.doc.blob }],
      resumen: { tipo_op: 'documento', entidad: input.entidad, tipo: input.tipo, nombre: input.doc.nombre },
    });
    // No need to invalidate the cache: getDocumentos() re-reads from the server
    // (catalog.refresh) on the next online load, picking up the synced row.
  }

  private registerHandler(): void {
    this.sync.register(TIPO_OP, async (payload, photoPaths) => {
      const path = photoPaths['documento'];
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id ?? null;
      // P3 — usar ON CONFLICT DO NOTHING (ignoreDuplicates), NO DO UPDATE: el rol
      // `authenticated` tiene INSERT en sgc.documentos pero NO UPDATE, y un upsert
      // con DO UPDATE exige UPDATE → fallaba con 42501 "permission denied" y la
      // subida nunca aterrizaba (los archivos sí subían a Storage, pero la fila de
      // sgc.documentos nunca se creaba → "sin documentos"). Como el `id` es un UUID
      // de cliente único, DO NOTHING es idempotente en los reenvíos.
      const { error } = await this.supabase.client.from('documentos').upsert(
        {
          id: payload['id'],
          entidad: payload['entidad'],
          entidad_id: payload['entidad_id'],
          tipo: payload['tipo'],
          nombre: (payload['nombre'] as string) ?? null,
          path,
          subido_por: uid,
        },
        { onConflict: 'id', ignoreDuplicates: true },
      );
      if (error) throwSyncError(error);
    });
  }
}
