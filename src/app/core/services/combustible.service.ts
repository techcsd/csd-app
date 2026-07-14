import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { CombustibleCaptura, UltimaEchada } from '../models/combustible.model';
import { db } from '../db/app-db';

const CATALOG_ULTIMA = 'combustible_ultima'; // + `:${vehiculoId}`

/**
 * Fuel-log data + write path. The previous fill-up (for live km/rendimiento
 * validation) is read through the catalog cache (offline-friendly); the write
 * is enqueued in the outbox and committed by the registered handler
 * (registrar_combustible_app) when there's connectivity. Mirrors
 * MantenimientosService / VehiculosService.
 */
@Injectable({ providedIn: 'root' })
export class CombustibleService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /**
   * The vehicle's previous fill-up + average km/gal, for live validation and
   * the abnormal-consumption preview. Cached per vehicle so it works offline.
   */
  async getUltimaEchada(vehiculoId: string): Promise<UltimaEchada> {
    const key = `${CATALOG_ULTIMA}:${vehiculoId}`;
    const data = await this.catalog.refresh<UltimaEchada>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('registros_combustible')
        .select('kilometraje, fecha, rendimiento_km_gal')
        .eq('vehiculo_id', vehiculoId)
        .not('kilometraje', 'is', null)
        .order('kilometraje', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<{
        kilometraje: number | null;
        fecha: string | null;
        rendimiento_km_gal: number | null;
      }>;
      const rends = rows
        .map((r) => r.rendimiento_km_gal)
        .filter((x): x is number => x != null);
      const promedio = rends.length ? rends.reduce((a, b) => a + b, 0) / rends.length : null;
      return {
        km: rows.length ? rows[0].kilometraje : null,
        fecha: rows.length ? rows[0].fecha : null,
        promedio_rendimiento: promedio,
        n_echadas: rends.length,
      };
    });
    const base = data ?? { km: null, fecha: null, promedio_rendimiento: null, n_echadas: 0 };

    // Considera echadas ya capturadas pero aún en la cola offline (sin sincronizar):
    // sin esto, una 2ª echada offline usa el km del servidor como base y la RPC la
    // rechaza al sincronizar (km <= km_anterior) dejándola en error permanente.
    const pendKm = await this.maxKmPendiente(vehiculoId);
    if (pendKm != null && (base.km == null || pendKm > base.km)) {
      return { ...base, km: pendKm };
    }
    return base;
  }

  /** Mayor kilometraje de echadas de este vehículo aún pendientes en el outbox. */
  private async maxKmPendiente(vehiculoId: string): Promise<number | null> {
    try {
      const ops = await db.outbox.where('tipo_op').equals('combustible').toArray();
      let max: number | null = null;
      for (const op of ops) {
        const p = op.payload as { vehiculo_id?: string; kilometraje?: number };
        if (p?.vehiculo_id === vehiculoId && typeof p.kilometraje === 'number') {
          if (max == null || p.kilometraje > max) max = p.kilometraje;
        }
      }
      return max;
    } catch {
      return null;
    }
  }

  /** Queue a fuel record. Works fully offline; syncs when there's signal. */
  async registrar(input: CombustibleCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = [
      {
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `combustible/${id}/recibo.jpg`,
        slot: 'recibo',
        blob: input.fotoRecibo,
      },
      {
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `combustible/${id}/tablero.jpg`,
        slot: 'tablero',
        blob: input.fotoTablero,
      },
    ];

    await this.sync.enqueue({
      id,
      tipo_op: 'combustible',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        conductor_id: input.conductorId,
        fecha: input.fecha,
        kilometraje: Math.round(input.kilometraje), // RPC param is integer
        galones: input.galones,
        monto: input.monto,
        estacion: input.estacion,
      },
      fotos,
      resumen: {
        placa: input.placa,
        galones: input.galones,
        monto: input.monto,
        capturado_en,
      },
    });

    // The "última echada" cache changes after a fill-up; refresh best-effort.
    void this.getUltimaEchada(input.vehiculoId);
  }

  private registerHandler(): void {
    this.sync.register('combustible', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_combustible_app', {
        p_client_uuid: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: payload['conductor_id'] ?? null,
        p_fecha: payload['fecha'],
        p_kilometraje: payload['kilometraje'],
        p_galones: payload['galones'],
        p_monto: payload['monto'],
        p_estacion: payload['estacion'] ?? null,
        p_foto_recibo_path: photoPaths['recibo'] ?? null,
        p_foto_tablero_path: photoPaths['tablero'] ?? null,
        p_notas: null,
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);
    });
  }
}
