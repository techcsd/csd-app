import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';

/** AF36 — un acta de recepción/traspaso de vehículo (con nombres resueltos). */
export interface ActaTraspaso {
  id: string;
  vehiculo_id: string | null;
  placa: string | null;
  km: number | null;
  de_usuario_id: string | null;
  de_nombre: string | null;
  a_usuario_id: string | null;
  a_nombre: string | null;
  llave1_ubicacion_tipo: string | null;
  fotos: string[] | null;
  notas: string | null;
  created_at: string;
}

/** AF34 — datos del traspaso/recepción de un vehículo (flujo unificado). */
export interface TraspasoCaptura {
  vehiculoId: string;
  km: number | null;
  /** Checklist corto de condiciones + km (queda en el acta como `condiciones`). */
  condiciones: unknown;
  /** Fotos guiadas ext/int (slot → blob). */
  fotos: Record<string, Blob>;
  firma: Blob | null;
  llave1Ubicacion: 'chofer_asignado' | 'oficina_central' | 'otro' | null;
  llave1Detalle: string | null;
  notas: string | null;
}

/**
 * AF34 — "Asignarme vehículo" unificado con pre-uso: el usuario recibe un vehículo
 * (incluso si estaba asignado a otro), documenta sus condiciones (checklist + fotos
 * + km + firma) y el traspaso queda como ACTA. La asignación pasa a él y al
 * anterior se le notifica. Offline-first por outbox → RPC `traspasar_vehiculo`
 * (reasigna + acta + notifica + registra la llave 1).
 */
@Injectable({ providedIn: 'root' })
export class TraspasoService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** AF36 — historial de recepciones/traspasos del usuario (online-first + cache). */
  async misActas(): Promise<ActaTraspaso[]> {
    const data = await this.catalog.refresh<ActaTraspaso[]>('mis_actas_traspaso', async () => {
      const { data, error } = await this.supabase.client.rpc('mis_actas_traspaso');
      if (error) throw new Error(error.message);
      return (data as ActaTraspaso[]) ?? [];
    });
    return data ?? [];
  }

  async enqueueTraspaso(input: TraspasoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `traspaso/${id}/firma.png`, slot: 'firma', blob: input.firma });
    }
    for (const [slot, blob] of Object.entries(input.fotos)) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `traspaso/${id}/${slot}.jpg`, slot, blob });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'vehiculo_traspaso',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        km: input.km,
        condiciones: input.condiciones,
        llave1_ubicacion: input.llave1Ubicacion,
        llave1_detalle: input.llave1Detalle,
        notas: input.notas,
        capturado_en,
      },
      fotos,
      resumen: { tipo: 'vehiculo_traspaso', vehiculo_id: input.vehiculoId, capturado_en },
    });
  }

  private registerHandler(): void {
    this.sync.register('vehiculo_traspaso', async (payload, photoPaths) => {
      // Fotos del acta: todas las guiadas + la firma al final.
      const fotoPaths = Object.entries(photoPaths)
        .filter(([slot]) => slot !== 'firma')
        .map(([, p]) => p)
        .filter((p): p is string => !!p);
      if (photoPaths['firma']) fotoPaths.push(photoPaths['firma']);
      const { error } = await this.supabase.client.rpc('traspasar_vehiculo', {
        p_vehiculo_id: payload['vehiculo_id'],
        p_km: payload['km'] ?? null,
        p_condiciones: payload['condiciones'] ?? null,
        p_fotos: fotoPaths,
        p_llave1_ubicacion: payload['llave1_ubicacion'] ?? null,
        p_llave1_detalle: payload['llave1_detalle'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
      // Km/asignación cambiaron: invalidar las caches de flota (regla no-retroceso).
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones');
      await this.catalog.invalidate('vehiculos_disponibles_v2');
      await this.catalog.invalidate('mis_actas_traspaso'); // AF36
    });
  }
}
