import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Conduce, RutaHoy } from '../models/transporte.model';

const CATALOG_CONDUCES = 'mis_conduces';
const CATALOG_RUTAS = 'mis_rutas';

/** Delivery capture the conduce screen hands to entregarConduce(). */
export interface ConduceEntregaCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  receptor: string;
  notas: string | null;
  fotoEntrega: Blob;
  firma: Blob;
}

/**
 * Driver's conduces (dispatched material) + routes. Delivery confirmation is
 * enqueued offline and committed via sgc.entregar_conduce, closing SGC's
 * existing despachado → entregado / entregado_incompleto trazabilidad.
 */
@Injectable({ providedIn: 'root' })
export class ConducesService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  async misConduces(): Promise<Conduce[]> {
    const data = await this.catalog.refresh<Conduce[]>(CATALOG_CONDUCES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_hoy');
      if (error) throw new Error(error.message);
      return (data as Conduce[]) ?? [];
    });
    return data ?? [];
  }

  async misRutas(): Promise<RutaHoy[]> {
    const data = await this.catalog.refresh<RutaHoy[]>(CATALOG_RUTAS, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_rutas_hoy');
      if (error) throw new Error(error.message);
      return (data as RutaHoy[]) ?? [];
    });
    return data ?? [];
  }

  async marcarRuta(rutaId: string, estado: 'en_curso' | 'completada' | 'cancelada'): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_ruta_estado', {
      p_ruta_id: rutaId,
      p_estado: estado,
    });
    if (error) throw new Error(error.message);
    void this.misRutas();
  }

  /** Queue a conduce delivery (photo + receiver + signature). Offline-safe. */
  async entregarConduce(input: ConduceEntregaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_entrega',
      capturado_en,
      payload: {
        salida_id: input.salidaId,
        items: input.items,
        receptor: input.receptor,
        notas: input.notas,
      },
      fotos: [
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-entrega.jpg`,
          slot: 'entrega',
          blob: input.fotoEntrega,
        },
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-firma.png`,
          slot: 'firma',
          blob: input.firma,
        },
      ],
      resumen: { salida_id: input.salidaId, receptor: input.receptor, capturado_en },
    });

    void this.misConduces();
  }

  private registerHandler(): void {
    this.sync.register('conduce_entrega', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('entregar_conduce', {
        p_salida_id: payload['salida_id'],
        p_items: payload['items'],
        p_receptor: payload['receptor'],
        p_firma_url: photoPaths['firma'],
        p_foto_url: photoPaths['entrega'],
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
