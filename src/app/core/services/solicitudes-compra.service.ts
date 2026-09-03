import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Proyecto } from '../models/bitacora.model';
import { MiSolicitudCompra, SolicitudCompraCaptura } from '../models/solicitud-compra.model';

const CAT_MIS = 'mis_solicitudes_compra';

/**
 * BH7/BH8 — Solicitud de compra en la app. La CREA Compras (Raykler) cuando el
 * sistema no la generó solo. Offline-first: entra al outbox como todo (3 categorías
 * de BG1) y llega por `crear_solicitud_compra_app`, IDEMPOTENTE por client_id (un
 * reintento no duplica). La lista "Mis solicitudes" es solo lectura, con procedencia
 * (folio REQ si nació del faltante de una requisición). La conversión a Orden de
 * Compra sigue en management (web).
 */
@Injectable({ providedIn: 'root' })
export class SolicitudesCompraService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Obras para el selector: directorio amplio (Compras pide para cualquier obra). */
  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>('proyectos_directorio', async () => {
      const { data, error } = await this.supabase.client.rpc('directorio_proyectos');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** BH7 — mis solicitudes de compra (solo lectura), con estado + procedencia. */
  async misSolicitudes(): Promise<MiSolicitudCompra[]> {
    const out = await this.catalog.refreshDetailed<MiSolicitudCompra[]>(CAT_MIS, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_solicitudes_compra_app');
      if (error) throw new Error(error.message);
      return (data as MiSolicitudCompra[]) ?? [];
    });
    // BH6-pattern — un fallo sin caché se propaga (estado de error), no un falso vacío.
    if (out.failed && !out.fromCache) {
      throw new Error('No pudimos cargar tus solicitudes de compra. Revisa la conexión.');
    }
    return out.data ?? [];
  }

  async invalidarCache(): Promise<void> {
    await this.catalog.invalidate(CAT_MIS);
  }

  /**
   * BH8 — encola la creación de una solicitud de compra (offline-first). El client
   * UUID es a la vez el id del sobre del outbox y la llave de idempotencia server.
   */
  async enqueue(input: SolicitudCompraCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'solicitud_compra_crear',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        notas: input.notas,
        categoria: input.categoria,
        items: input.items,
      },
      fotos: [],
      resumen: { tipo: 'solicitud_compra_crear', capturado_en, items: input.items.length },
    });
    void this.misSolicitudes().catch(() => {});
    return id;
  }

  private registerHandler(): void {
    this.sync.register('solicitud_compra_crear', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_solicitud_compra_app', {
        p_proyecto_id: payload['proyecto_id'],
        p_notas: payload['notas'] ?? null,
        p_items: payload['items'],
        p_categoria: payload['categoria'] ?? null,
        // Idempotencia: el mismo client_id NUNCA crea una segunda solicitud.
        p_client_id: payload['id'],
      });
      if (error) throwSyncError(error);
    });
  }
}
