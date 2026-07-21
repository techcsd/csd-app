import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { ChecklistPlantilla } from '../models/checklist-preuso.model';
import { ReporteSemanalCaptura, ReporteSemanalVeh } from '../models/reporte-semanal.model';

const CATALOG_PLANTILLA = 'reporte_semanal_plantilla';
const CATALOG_SEMANA = 'reporte_semanal_semana';

/**
 * Weekly vehicle report (R3). Reuses the checklist engine with the `semanal`
 * template — a fast 5-question form (no photos, no signature). The write goes
 * through the outbox to registrar_checklist_vehiculo (tipo='inspeccion', the
 * template's frecuencia='semanal' is what the compliance view keys off).
 * Mirrors ChecklistPreusoService.
 */
@Injectable({ providedIn: 'root' })
export class ReporteSemanalService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** The active weekly template with its items, cached for offline use. */
  async getPlantilla(): Promise<ChecklistPlantilla | null> {
    const data = await this.catalog.refresh<ChecklistPlantilla | null>(CATALOG_PLANTILLA, async () => {
      const { data, error } = await this.supabase.client
        .from('checklist_plantillas')
        .select('id, codigo, nombre, categoria, descripcion, activo, orden, items:checklist_plantilla_items(*)')
        .eq('frecuencia', 'semanal')
        .eq('activo', true)
        .order('orden', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const p = data as ChecklistPlantilla;
      return { ...p, items: [...(p.items ?? [])].sort((a, b) => a.orden - b.orden) };
    });
    return data ?? null;
  }

  /**
   * This week's report status for the current user's vehicles (current ISO
   * week). Drives the "Reporte semanal" badge and the vehicle picker. Cached.
   */
  async getSemana(): Promise<ReporteSemanalVeh[]> {
    const data = await this.catalog.refresh<ReporteSemanalVeh[]>(CATALOG_SEMANA, async () => {
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];
      // Current week = the most recent semana_inicio in the view.
      const { data, error } = await this.supabase.client
        .from('v_reporte_semanal_cumplimiento')
        .select('vehiculo_id, placa, tiene_reporte, reporte_fecha, resultado, semana_inicio, semana_fin')
        .eq('chofer_usuario_id', uid)
        .order('semana_inicio', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data as ReporteSemanalVeh[]) ?? [];
      if (!rows.length) return [];
      const current = rows[0].semana_inicio;
      return rows.filter((r) => r.semana_inicio === current);
    });
    return data ?? [];
  }

  /** Count of the current user's vehicles still missing this week's report. */
  async pendientesCount(): Promise<number> {
    return (await this.getSemana()).filter((v) => !v.tiene_reporte).length;
  }

  /** Queue a weekly report. Works fully offline; syncs when there's signal. */
  async enqueue(input: ReporteSemanalCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const respuestas = input.respuestas.map((r) => ({
      etiqueta: r.etiqueta,
      seccion: r.seccion,
      es_critico: r.es_critico,
      respuesta: r.respuesta,
      comentario: r.comentario,
      orden: r.orden,
    }));

    // S26a — sube firma + fotos guiadas al bucket `vehiculos` (igual que pre-uso).
    const fotos: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }> = [];
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/firma.png`, slot: 'firma', blob: input.firma });
    }
    for (const [slot, blob] of Object.entries(input.fotos)) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/${slot}.jpg`, slot, blob });
    }

    await this.sync.enqueue({
      id,
      tipo_op: 'reporte_semanal',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        plantilla_id: input.plantillaId,
        conductor_id: input.conductorId,
        fecha: input.fecha,
        kilometraje: input.kilometraje,
        nivel_combustible: input.nivelCombustible,
        observacion: input.observacion,
        respuestas,
      },
      fotos,
      resumen: {
        placa: input.placa,
        plantilla: 'Reporte semanal',
        resultado: input.resultado,
        capturado_en,
      },
    });

    // The compliance list changes after a report; refresh best-effort.
    void this.getSemana();
  }

  private registerHandler(): void {
    this.sync.register('reporte_semanal', async (payload, photoPaths) => {
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

      // S26a — fotos guiadas (todo menos la firma) + firma aparte.
      const fotos = Object.entries(photoPaths)
        .filter(([slot]) => slot !== 'firma')
        .map(([slot, path]) => ({ storage_path: path, slot }));

      const { error } = await this.supabase.client.rpc('registrar_checklist_vehiculo', {
        p_id: payload['id'],
        p_plantilla_id: payload['plantilla_id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: payload['conductor_id'] ?? null,
        // The tipo CHECK only allows pre_uso|inspeccion; the weekly nature is
        // carried by the template's frecuencia='semanal'.
        p_tipo: 'inspeccion',
        p_fecha: payload['fecha'],
        p_datos: {},
        p_kilometraje: payload['kilometraje'] ?? null,
        p_respuestas: respuestas,
        p_fotos: fotos,
        p_firma_path: photoPaths['firma'] ?? null,
        p_observaciones: payload['observacion'] ?? null,
        p_capturado_en: payload['capturado_en'],
        p_nivel_combustible: payload['nivel_combustible'] ?? null,
      });
      if (error) throwSyncError(error);

      // P7 — el RPC avanza vehiculos.kilometraje (regla no-retroceso). Invalidar
      // las caches con km para que la app muestre el nuevo valor.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
    });
  }
}
