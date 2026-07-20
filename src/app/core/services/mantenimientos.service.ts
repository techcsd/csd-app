import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { CatalogService } from '../sync/catalog.service';

export type MantenimientoTipo = 'preventivo' | 'correctivo' | 'emergencia';

/** Input the maintenance wizard hands to enqueueMantenimiento(). */
export interface MantenimientoCaptura {
  vehiculoId: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string; // YYYY-MM-DD
  km: number | null;
  /** Up to 3 optional evidence photos, in capture order. */
  fotos: Blob[];
  placa: string;
}

/**
 * Vehicle maintenance report write path. Mirrors VehiculosService: the capture
 * is enqueued in the offline outbox and committed by the registered handler
 * (crear_mantenimiento_app) when there's connectivity.
 */
@Injectable({ providedIn: 'root' })
export class MantenimientosService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);
  private catalog = inject(CatalogService);

  constructor() {
    this.registerHandler();
  }

  /** Queue a maintenance report. Works fully offline; syncs when there's signal. */
  async enqueueMantenimiento(input: MantenimientoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = input.fotos.map((blob, idx) => ({
      id: crypto.randomUUID(),
      bucket: 'vehiculos',
      path: `mantenimiento/${id}/foto_${idx}.jpg`,
      slot: `foto_${idx}`,
      blob,
    }));

    await this.sync.enqueue({
      id,
      tipo_op: 'mantenimiento',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        tipo: input.tipo,
        descripcion: input.descripcion,
        fecha: input.fecha,
        km: input.km,
      },
      fotos,
      resumen: { placa: input.placa, tipo: input.tipo, capturado_en },
    });
  }

  private registerHandler(): void {
    this.sync.register('mantenimiento', async (payload, photoPaths) => {
      const fotos = Object.entries(photoPaths).map(([slot, path]) => ({
        storage_path: path,
        slot,
      }));

      const { error } = await this.supabase.client.rpc('crear_mantenimiento_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_tipo: payload['tipo'],
        p_descripcion: payload['descripcion'],
        p_fecha: payload['fecha'],
        p_km: payload['km'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);

      // P7 — el RPC avanza vehiculos.kilometraje; invalidar caches con km.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
    });
  }
}
