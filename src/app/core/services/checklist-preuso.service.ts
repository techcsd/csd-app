import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { ChecklistCaptura, ChecklistPlantilla } from '../models/checklist-preuso.model';

// U10 — clave nueva ('_preuso') para invalidar cualquier caché viejo con la
// plantilla de 33 ítems (PRE-USO-V2). Ahora solo trae plantillas de pre-uso.
const CATALOG_PLANTILLAS = 'checklist_plantillas_preuso';

/**
 * Pre-use vehicle checklist data + write path. Template reads go through the
 * catalog cache (offline-friendly); the checklist write is enqueued in the
 * outbox and committed by the registered handler when online. Mirrors
 * VehiculosService.
 */
@Injectable({ providedIn: 'root' })
export class ChecklistPreusoService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Active checklist templates with their items, cached for offline use. */
  async getPlantillas(): Promise<ChecklistPlantilla[]> {
    const data = await this.catalog.refresh<ChecklistPlantilla[]>(CATALOG_PLANTILLAS, async () => {
      const { data, error } = await this.supabase.client
        .from('checklist_plantillas')
        .select(
          'id, codigo, nombre, categoria, descripcion, activo, orden, frecuencia, items:checklist_plantilla_items(*)',
        )
        .eq('activo', true)
        // U10 — solo plantillas de pre-uso (nunca la semanal ni una legacy):
        // hoy la activa es PRE-USO-V3 (10 tópicos). Evita mostrar 33 preguntas.
        .eq('frecuencia', 'preuso')
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as ChecklistPlantilla[]) ?? []).map((p) => ({
        ...p,
        items: [...(p.items ?? [])].sort((a, b) => a.orden - b.orden),
      }));
    });
    return data ?? [];
  }

  /** Queue a pre-use checklist. Works fully offline; syncs when there's signal. */
  async enqueueChecklist(input: ChecklistCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const fotos = [
      {
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `checklist/${id}/firma.png`,
        slot: 'firma',
        blob: input.firma,
      },
      // The 7 mandatory guided shots, fixed slot names (see FOTOS_PREUSO).
      ...Object.entries(input.fotos).map(([slot, blob]) => ({
        id: crypto.randomUUID(),
        bucket: 'vehiculos',
        path: `checklist/${id}/${slot}.jpg`,
        slot,
        blob,
      })),
    ];

    const respuestas = input.respuestas.map((r, idx) => {
      let fotoSlot: string | undefined;
      if (r.blob) {
        fotoSlot = `item_${idx}`;
        fotos.push({
          id: crypto.randomUUID(),
          bucket: 'vehiculos',
          path: `checklist/${id}/item_${idx}.jpg`,
          slot: fotoSlot,
          blob: r.blob,
        });
      }
      return {
        etiqueta: r.etiqueta,
        seccion: r.seccion,
        es_critico: r.es_critico,
        respuesta: r.respuesta,
        comentario: r.comentario,
        orden: r.orden,
        fotoSlot,
      };
    });

    await this.sync.enqueue({
      id,
      tipo_op: 'checklist_preuso',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        plantilla_id: input.plantillaId,
        conductor_id: input.conductorId,
        tipo: 'pre_uso',
        fecha: input.fecha,
        kilometraje: input.kilometraje,
        nivel_combustible: input.nivelCombustible,
        datos: {},
        observacion: input.observacion,
        respuestas,
      },
      fotos,
      resumen: {
        placa: input.placa,
        plantilla: input.plantilla,
        resultado: input.resultado,
        capturado_en,
      },
    });
  }

  private registerHandler(): void {
    this.sync.register('checklist_preuso', async (payload, photoPaths) => {
      const respuestas = (
        payload['respuestas'] as Array<{
          etiqueta: string;
          seccion: string;
          es_critico: boolean;
          respuesta: string;
          comentario: string | null;
          orden: number;
        }>
      ).map((r) => ({
        etiqueta: r.etiqueta,
        seccion: r.seccion,
        es_critico: r.es_critico,
        respuesta: r.respuesta,
        comentario: r.comentario,
        orden: r.orden,
      }));

      const fotos = Object.entries(photoPaths)
        .filter(([slot]) => slot !== 'firma')
        .map(([slot, path]) => ({ storage_path: path, slot }));

      const { error } = await this.supabase.client.rpc('registrar_checklist_vehiculo', {
        p_id: payload['id'],
        p_plantilla_id: payload['plantilla_id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: payload['conductor_id'] ?? null,
        p_tipo: 'pre_uso',
        p_fecha: payload['fecha'],
        p_datos: payload['datos'] ?? {},
        p_kilometraje: payload['kilometraje'] ?? null,
        p_respuestas: respuestas,
        p_fotos: fotos,
        p_firma_path: photoPaths['firma'] ?? null,
        p_observaciones: payload['observacion'] ?? null,
        p_capturado_en: payload['capturado_en'],
        p_nivel_combustible: payload['nivel_combustible'] ?? null,
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);
    });
  }
}
