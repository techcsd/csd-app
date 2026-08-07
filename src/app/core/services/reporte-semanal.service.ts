import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';
import { ChecklistPlantilla } from '../models/checklist-preuso.model';
import {
  FOTOS_SEMANAL_FALLBACK,
  FotoSlotSemanal,
  ReporteSemanalCaptura,
  ReporteSemanalVeh,
} from '../models/reporte-semanal.model';

const CATALOG_PLANTILLA = 'reporte_semanal_plantilla';
// Z13: bumped a _v2 para traer el estado global (reportado_por/at).
const CATALOG_SEMANA = 'reporte_semanal_semana_v2';
// AA3: estado de la semana por VEHÍCULO (sin filtrar por chofer) para el listado.
const CATALOG_SEMANA_TODAS = 'reporte_semanal_todas_v1';

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
  private audioNotas = inject(AudioNotasService);

  constructor() {
    this.registerHandler();
  }

  /**
   * AC14 — plantilla activa del semanal por TIPO de vehículo, cacheada offline.
   * El telehandler usa su plantilla (`tipo_vehiculo='telehandler'`, los 15
   * puntos); el resto usa la genérica (`tipo_vehiculo` nulo). Si no existe la
   * específica, cae a la genérica para no dejar el wizard sin ítems.
   */
  async getPlantilla(tipoVehiculo?: string | null): Promise<ChecklistPlantilla | null> {
    const tipo = tipoVehiculo?.trim().toLowerCase() || null;
    const key = `${CATALOG_PLANTILLA}_${tipo ?? 'generic'}`;
    const data = await this.catalog.refresh<ChecklistPlantilla | null>(key, async () => {
      const base = () =>
        this.supabase.client
          .from('checklist_plantillas')
          .select('id, codigo, nombre, categoria, descripcion, activo, orden, items:checklist_plantilla_items(*)')
          .eq('frecuencia', 'semanal')
          .eq('activo', true);

      let row: unknown = null;
      if (tipo) {
        const { data, error } = await base()
          .eq('tipo_vehiculo', tipo)
          .order('orden', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        row = data;
      }
      // Fallback (o tipo genérico): la plantilla sin tipo_vehiculo (camiones).
      if (!row) {
        const { data, error } = await base()
          .is('tipo_vehiculo', null)
          .order('orden', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        row = data;
      }
      if (!row) return null;
      const p = row as ChecklistPlantilla;
      return { ...p, items: [...(p.items ?? [])].sort((a, b) => a.orden - b.orden) };
    });
    return data ?? null;
  }

  /**
   * Z11 — fotos guiadas del reporte semanal desde `checklist_foto_slots`
   * (frecuencia='semanal'), agrupables por sección (Exterior/Interior), cacheadas
   * offline. Fallback al seed local si no se pudo leer (arranque en frío).
   */
  async getFotoSlotsSemanal(): Promise<FotoSlotSemanal[]> {
    const data = await this.catalog.refresh<FotoSlotSemanal[]>('foto_slots_semanal', async () => {
      const { data, error } = await this.supabase.client
        .from('checklist_foto_slots')
        .select('slot, etiqueta, seccion, orden')
        .eq('frecuencia', 'semanal')
        .eq('activo', true)
        .order('seccion', { ascending: true })
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data as Array<{ slot: string; etiqueta: string; seccion: string }>) ?? [];
      return rows.map((r) => ({
        slot: r.slot,
        label: r.etiqueta,
        hint: /interior/i.test(r.seccion) ? '💺' : '🚙',
        seccion: r.seccion,
      }));
    });
    return data && data.length ? data : FOTOS_SEMANAL_FALLBACK;
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
        .select(
          'vehiculo_id, placa, tiene_reporte, reporte_fecha, resultado, semana_inicio, semana_fin, reportado_por, reportado_por_id, reportado_at, km_reporte',
        )
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

  /**
   * AA3 — estado de la semana en curso por VEHÍCULO, SIN filtrar por chofer. El
   * listado usa esto para marcar reportado cualquier vehículo con reporte de la
   * semana, aunque no esté asignado a quien lo reportó (bug del "vehículo de
   * prueba": la op drenaba pero seguía "pendiente" porque getSemana solo traía
   * mis vehículos). La vista es `security_invoker`, así que RLS limita las filas
   * a lo que el usuario puede ver (un chofer no ve la flota entera). El badge del
   * hub sigue usando getSemana() (scoped a mis vehículos), sin regresión.
   */
  async getSemanaTodas(): Promise<ReporteSemanalVeh[]> {
    const data = await this.catalog.refresh<ReporteSemanalVeh[]>(CATALOG_SEMANA_TODAS, async () => {
      const { data, error } = await this.supabase.client
        .from('v_reporte_semanal_cumplimiento')
        .select(
          'vehiculo_id, placa, tiene_reporte, reporte_fecha, resultado, semana_inicio, semana_fin, reportado_por, reportado_por_id, reportado_at, km_reporte',
        )
        .order('semana_inicio', { ascending: false });
      if (error) throw new Error(error.message);
      const rows = (data as ReporteSemanalVeh[]) ?? [];
      if (!rows.length) return [];
      const current = rows[0].semana_inicio;
      return rows.filter((r) => r.semana_inicio === current);
    });
    return data ?? [];
  }

  /** Queue a weekly report. Works fully offline; syncs when there's signal. */
  async enqueue(input: ReporteSemanalCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    const respuestas = input.respuestas.map((r, i) => ({
      etiqueta: r.etiqueta,
      seccion: r.seccion,
      es_critico: r.es_critico,
      respuesta: r.respuesta,
      comentario: r.comentario,
      orden: r.orden,
      // AA13 — slots de la foto + nota de voz opcionales de la falla; el handler
      // los resuelve a foto_path / audio_path de la respuesta.
      foto_slot: r.blob instanceof Blob ? `falla_foto_${i}` : null,
      audio_slot: r.voz instanceof Blob ? `falla_audio_${i}` : null,
    }));

    // S26a — sube firma + fotos guiadas al bucket `vehiculos` (igual que pre-uso).
    const fotos: Array<{ id: string; bucket: string; path: string; slot: string; blob: Blob }> = [];
    if (input.firma) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/firma.png`, slot: 'firma', blob: input.firma });
    }
    for (const [slot, blob] of Object.entries(input.fotos)) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/${slot}.jpg`, slot, blob });
    }
    // AA13 — foto + nota de voz por falla marcada.
    input.respuestas.forEach((r, i) => {
      if (r.blob instanceof Blob) {
        fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/falla_foto_${i}.jpg`, slot: `falla_foto_${i}`, blob: r.blob });
      }
      if (r.voz instanceof Blob) {
        fotos.push({ id: crypto.randomUUID(), bucket: 'vehiculos', path: `checklist/${id}/falla_audio_${i}.webm`, slot: `falla_audio_${i}`, blob: r.voz });
      }
    });
    // Z23 — notas de voz (audio_notas, bucket flota-documentos).
    const audio = this.audioNotas.buildAttachments('reporte_semanal', id, AUDIO_BUCKET_FLOTA, input.voces ?? []);
    fotos.push(...audio.fotos);

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
        audios: audio.audios, // Z23
      },
      fotos,
      resumen: {
        placa: input.placa,
        plantilla: 'Inspección de vehículo',
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
          foto_slot?: string | null;
          audio_slot?: string | null;
        }>
      ).map((r) => ({
        etiqueta: r.etiqueta,
        seccion: r.seccion,
        es_critico: r.es_critico,
        respuesta: r.respuesta,
        comentario: r.comentario,
        orden: r.orden,
        // AA13 — foto + voz de la falla resueltas a path.
        foto_path: r.foto_slot ? (photoPaths[r.foto_slot] ?? null) : null,
        audio_path: r.audio_slot ? (photoPaths[r.audio_slot] ?? null) : null,
      }));

      // S26a — fotos guiadas (todo menos firma, notas de voz y evidencia de falla).
      const fotos = Object.entries(photoPaths)
        .filter(
          ([slot]) =>
            slot !== 'firma' &&
            !slot.startsWith('audio_') &&
            !slot.startsWith('falla_foto_') &&
            !slot.startsWith('falla_audio_'),
        )
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

      // Z23 — registrar las notas de voz (idempotente por path).
      await this.audioNotas.commit(
        'reporte_semanal',
        payload['id'] as string,
        payload['audios'] as AudioNotaMeta[] | undefined,
        photoPaths,
      );

      // P7 — el RPC avanza vehiculos.kilometraje (regla no-retroceso). Invalidar
      // las caches con km para que la app muestre el nuevo valor.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones'); // AF21
      // U8 — invalidar el cumplimiento semanal: al drenar, el listado debe
      // reconsultar el servidor (ahora tiene_reporte=true) y no volver a
      // "Reportar" por caché vieja mientras la op ya se fue del outbox.
      await this.catalog.invalidate(CATALOG_SEMANA);
      await this.catalog.invalidate(CATALOG_SEMANA_TODAS); // AA3
    });
  }
}
