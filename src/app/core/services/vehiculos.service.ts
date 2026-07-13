import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  CombustibleNivel,
  DanoCaptura,
  EntregaTipo,
  FOTOS_REQUERIDAS,
  PendientesTransporte,
} from '../models/transporte.model';

const REQUIRED_SLOTS = FOTOS_REQUERIDAS.map((f) => f.slot);
const CATALOG_PENDIENTES = 'pendientes_transporte';

/** Input the checklist wizard hands to enqueueEntrega(). */
export interface EntregaCaptura {
  vehiculoId: string;
  tipo: EntregaTipo;
  km: number;
  combustible: CombustibleNivel;
  observacion: string | null;
  gps: { lat: number; lng: number } | null;
  /** slot → compressed photo blob (the 6 required shots). */
  fotos: Record<string, Blob>;
  firma: Blob;
  danos: Array<DanoCaptura & { blob: Blob }>;
  placa: string;
}

/**
 * Transporte data + the vehicle-checklist write path. Reads go through the
 * catalog cache (offline-friendly); the checklist write is enqueued in the
 * outbox and committed by the registered handler when online.
 */
@Injectable({ providedIn: 'root' })
export class VehiculosService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Minimal vehicle header for the checklist (placa/modelo/km). */
  async getVehiculo(
    id: string,
  ): Promise<{ id: string; placa: string; marca: string; modelo: string; kilometraje: number } | null> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('id, placa, marca, modelo, kilometraje')
      .eq('id', id)
      .single();
    if (error) {
      // Offline: fall back to whatever the pending list cached.
      const p = await this.catalog.read<PendientesTransporte>(CATALOG_PENDIENTES);
      const hit = [...(p?.a_cargo ?? []), ...(p?.por_recibir ?? [])].find(
        (v) => v.vehiculo_id === id,
      );
      return hit
        ? { id, placa: hit.placa, marca: hit.marca, modelo: hit.modelo, kilometraje: hit.km }
        : null;
    }
    return data as unknown as {
      id: string;
      placa: string;
      marca: string;
      modelo: string;
      kilometraje: number;
    };
  }

  /** Vehicles to receive / already in charge, cached for offline. */
  async misPendientes(): Promise<PendientesTransporte> {
    const data = await this.catalog.refresh<PendientesTransporte>(CATALOG_PENDIENTES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_pendientes_transporte');
      if (error) throw new Error(error.message);
      return (data as PendientesTransporte) ?? { a_cargo: [], por_recibir: [] };
    });
    return data ?? { a_cargo: [], por_recibir: [] };
  }

  /** Queue a checklist. Works fully offline; syncs when there's signal. */
  async enqueueEntrega(input: EntregaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = [
      ...REQUIRED_SLOTS.map((slot) => ({
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `${id}/${slot}.jpg`,
        slot,
        blob: input.fotos[slot],
      })),
      {
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `${id}/firma.png`,
        slot: 'firma',
        blob: input.firma,
      },
      ...input.danos.map((d, i) => ({
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `${id}/dano_${i}.jpg`,
        slot: `dano_${i}`,
        blob: d.blob,
      })),
    ];

    await this.sync.enqueue({
      id,
      tipo_op: 'vehiculo_entrega',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        tipo: input.tipo,
        km: input.km,
        combustible: input.combustible,
        tiene_danos: input.danos.length > 0,
        observacion: input.observacion,
        gps: input.gps,
        capturado_en,
        danos: input.danos.map((d) => ({ zona: d.zona, descripcion: d.descripcion })),
      },
      fotos,
      resumen: { tipo: input.tipo, placa: input.placa, km: input.km, capturado_en },
    });

    // The pending list changes after a capture; refresh best-effort.
    void this.misPendientes();
  }

  private registerHandler(): void {
    this.sync.register('vehiculo_entrega', async (payload, photoPaths) => {
      const fotos = REQUIRED_SLOTS.map((slot) => ({ slot, path: photoPaths[slot] }));
      const danos = (payload['danos'] as Array<{ zona: string; descripcion: string }>).map(
        (d, i) => ({ zona: d.zona, descripcion: d.descripcion, foto_path: photoPaths[`dano_${i}`] }),
      );

      const { error } = await this.supabase.client.rpc('crear_entrega_vehiculo', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_tipo: payload['tipo'],
        p_km: payload['km'],
        p_combustible: payload['combustible'],
        p_tiene_danos: payload['tiene_danos'],
        p_danos: danos,
        p_firma_url: photoPaths['firma'],
        p_fotos: fotos,
        p_gps: payload['gps'] ?? null,
        p_capturado_en: payload['capturado_en'],
        p_observacion: payload['observacion'] ?? null,
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);
    });
  }
}
