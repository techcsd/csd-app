import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { CatalogService } from '../sync/catalog.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';

/**
 * X6-app — tipos de visita/mantenimiento tipificados, EXACTAMENTE los 4 que
 * acepta el servidor (`crear_mantenimiento_app`). Cualquier otro valor el RPC lo
 * coerce a 'preventivo', así que los valores viejos ('correctivo'/'emergencia')
 * se registraban mal → ahora usamos los canónicos.
 */
export type MantenimientoTipo = 'preventivo' | 'falla' | 'accidente_dano' | 'cambio_pieza';

/** Input the maintenance wizard hands to enqueueMantenimiento(). */
export interface MantenimientoCaptura {
  vehiculoId: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string; // YYYY-MM-DD
  km: number | null;
  /** X6-app — en visitas NO preventivas, si de paso se hizo preventivo. */
  incluyePreventivo: boolean;
  /** Up to 3 optional evidence photos, in capture order. */
  fotos: Blob[];
  /** Z23 — notas de voz múltiples (opcional). */
  voces?: Blob[];
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
  private audioNotas = inject(AudioNotasService);

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
    // Z23 — notas de voz (audio_notas, bucket flota-documentos).
    const audio = this.audioNotas.buildAttachments('mantenimiento', id, AUDIO_BUCKET_FLOTA, input.voces ?? []);
    fotos.push(...audio.fotos);

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
        incluye_preventivo: input.incluyePreventivo,
        audios: audio.audios, // Z23
      },
      fotos,
      resumen: { placa: input.placa, tipo: input.tipo, capturado_en },
    });
  }

  private registerHandler(): void {
    this.sync.register('mantenimiento', async (payload, photoPaths) => {
      const fotos = Object.entries(photoPaths)
        .filter(([slot]) => !slot.startsWith('audio_'))
        .map(([slot, path]) => ({ storage_path: path, slot }));

      const { error } = await this.supabase.client.rpc('crear_mantenimiento_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_tipo: payload['tipo'],
        p_descripcion: payload['descripcion'],
        p_fecha: payload['fecha'],
        p_km: payload['km'] ?? null,
        p_fotos: fotos,
        p_capturado_en: payload['capturado_en'],
        p_incluye_preventivo: payload['incluye_preventivo'] ?? false,
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);

      // Z23 — registrar las notas de voz (idempotente por path).
      await this.audioNotas.commit('mantenimiento', payload['id'] as string, payload['audios'] as AudioNotaMeta[] | undefined, photoPaths);

      // P7 — el RPC avanza vehiculos.kilometraje; invalidar caches con km.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
    });
  }
}
