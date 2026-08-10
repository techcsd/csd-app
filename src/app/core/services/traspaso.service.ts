import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';

/** AF36/AH14 — un acta de recepción/traspaso de vehículo (con nombres resueltos). */
export interface ActaTraspaso {
  id: string;
  vehiculo_id: string | null;
  placa: string | null;
  /** AH14 — reconocer el vehículo por marca + modelo, no solo la placa. */
  marca: string | null;
  modelo: string | null;
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

/** AH13 — evidencia de una falla del checklist: descripción + fotos + notas de voz. */
export interface FallaChecklist {
  etiqueta: string;
  descripcion: string | null;
  fotos: Blob[];
  voces: Blob[];
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
  /** AH13 — por cada item marcado como falla: texto + fotos + voz (van al acta). */
  fallas?: FallaChecklist[];
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
  private audioNotas = inject(AudioNotasService);

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

  /** AH14 — detalle completo de un acta (condiciones/fallas + fotos + audios + firmas). */
  async actaDetalle(id: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase.client.rpc('acta_traspaso_detalle', { p_acta_id: id });
    if (error) throw new Error(error.message);
    return (data as Record<string, unknown>) ?? null;
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

    // AH13 — evidencia por falla: fotos por item (slot falla_i_foto_j) + notas de
    // voz (aplanadas para slots únicos audio_k; se asocian por path a cada item).
    const fallas = input.fallas ?? [];
    const allVoces: Blob[] = [];
    const fallaAudioRange: { start: number; count: number }[] = [];
    for (const f of fallas) {
      fallaAudioRange.push({ start: allVoces.length, count: f.voces.length });
      allVoces.push(...f.voces);
    }
    const audioAtt = this.audioNotas.buildAttachments('traspaso_acta', id, AUDIO_BUCKET_FLOTA, allVoces);
    fotos.push(...audioAtt.fotos);

    const fallasMeta = fallas.map((f, i) => {
      const fotoSlots: string[] = [];
      f.fotos.forEach((blob, j) => {
        const slot = `falla_${i}_foto_${j}`;
        fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `traspaso/${id}/${slot}.jpg`, slot, blob });
        fotoSlots.push(slot);
      });
      const r = fallaAudioRange[i];
      const audioSlots = Array.from({ length: r.count }, (_, k) => `audio_${r.start + k}`);
      return { etiqueta: f.etiqueta, descripcion: f.descripcion, foto_slots: fotoSlots, audio_slots: audioSlots };
    });

    await this.sync.enqueue({
      id,
      tipo_op: 'vehiculo_traspaso',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        km: input.km,
        condiciones: input.condiciones,
        fallas_meta: fallasMeta, // AH13 — se resuelven a paths en el handler
        audios: audioAtt.audios, // AH13 — se registran contra el acta tras crearla
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
      // AH13 — resolver la evidencia de cada falla (fotos + audios ya subidos) dentro
      // de `condiciones`, para que el acta guarde por item: descripción + fotos + voz.
      const condiciones = (payload['condiciones'] as { items?: Record<string, unknown>[] } | null) ?? null;
      const fallasMeta = (payload['fallas_meta'] as {
        etiqueta: string; descripcion: string | null; foto_slots: string[]; audio_slots: string[];
      }[] | undefined) ?? [];
      if (condiciones && Array.isArray(condiciones.items) && fallasMeta.length) {
        for (const fm of fallasMeta) {
          const item = condiciones.items.find((it) => (it as { etiqueta?: string }).etiqueta === fm.etiqueta);
          if (item) {
            (item as Record<string, unknown>)['descripcion'] = fm.descripcion ?? null;
            (item as Record<string, unknown>)['fotos'] = fm.foto_slots.map((s) => photoPaths[s]).filter(Boolean);
            (item as Record<string, unknown>)['audios'] = fm.audio_slots.map((s) => photoPaths[s]).filter(Boolean);
          }
        }
      }

      // Fotos generales del acta: guiadas + firma. Excluye las fotos/audios de falla
      // (esas viven dentro de `condiciones`, no en el arreglo general).
      const fotoPaths = Object.entries(photoPaths)
        .filter(([slot]) => slot !== 'firma' && !slot.startsWith('falla_') && !slot.startsWith('audio_'))
        .map(([, p]) => p)
        .filter((p): p is string => !!p);
      if (photoPaths['firma']) fotoPaths.push(photoPaths['firma']);
      const { data: actaId, error } = await this.supabase.client.rpc('traspasar_vehiculo', {
        p_vehiculo_id: payload['vehiculo_id'],
        p_km: payload['km'] ?? null,
        p_condiciones: condiciones,
        p_fotos: fotoPaths,
        p_llave1_ubicacion: payload['llave1_ubicacion'] ?? null,
        p_llave1_detalle: payload['llave1_detalle'] ?? null,
        p_notas: payload['notas'] ?? null,
        // QA-5 (AJ15) — client UUID idempotente: un reintento devuelve el acta ya
        // creada en vez de duplicar acta + avance de km.
        p_id: payload['id'],
      });
      if (error) throwSyncError(error);
      // AH13 — registrar las notas de voz contra el acta (reproducción + transcripción).
      if (actaId) {
        await this.audioNotas.commit('traspaso_acta', actaId as string, payload['audios'] as AudioNotaMeta[] | undefined, photoPaths);
      }
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
