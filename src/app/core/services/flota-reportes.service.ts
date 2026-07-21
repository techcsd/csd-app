import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  AccidenteCaptura,
  ChecklistBreakdown,
  DanoCaptura,
  FlotaAccidente,
  FlotaEntrega,
  FlotaMulta,
  MultaCaptura,
} from '../models/flota-reportes.model';

const BUCKET_FOTOS = 'vehiculos'; // fotos de daño (upsert-safe)
const BUCKET_DOCS = 'flota-documentos'; // acta AMET + documento de multa

/**
 * S22/S24 — reportes de flota por outbox: accidente, daño (fuera de entregas) y
 * multa de conductor. Escriben vía los RPC security-definer `registrar_*_app`
 * (idempotentes por p_id). Fotos de daño → bucket `vehiculos`; acta AMET y
 * documento de multa → bucket privado `flota-documentos` (ambos upsert-safe).
 */
@Injectable({ providedIn: 'root' })
export class FlotaReportesService {
  private supabase = inject(SupabaseService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  /** S32 — multas del conductor (para su perfil de actividad). Online. */
  async getMultasConductor(conductorId: string): Promise<FlotaMulta[]> {
    const { data, error } = await this.supabase.client
      .from('conductor_multas')
      .select('id, fecha, motivo, monto, estado, created_at')
      .eq('conductor_id', conductorId)
      .order('fecha', { ascending: false })
      .limit(50);
    if (error) return [];
    return (data as FlotaMulta[]) ?? [];
  }

  /** S32 — entregas/recepciones del conductor (por su usuario). Online. */
  async getEntregasConductor(usuarioId: string): Promise<FlotaEntrega[]> {
    if (!usuarioId) return [];
    const { data, error } = await this.supabase.client
      .from('vehiculo_entregas')
      .select('id, tipo, km, created_at, vehiculo:vehiculos(placa)')
      .eq('conductor_usuario_id', usuarioId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return [];
    return ((data as unknown as FlotaEntrega[]) ?? []);
  }

  /** S32 — desglose de checklists del conductor: pre-usos vs semanales. Online. */
  async getChecklistsBreakdown(conductorId: string): Promise<ChecklistBreakdown> {
    if (!conductorId) return { preuso: 0, semanal: 0 };
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select('tipo')
      .eq('conductor_id', conductorId)
      .limit(500);
    if (error) return { preuso: 0, semanal: 0 };
    const rows = (data as { tipo: string }[]) ?? [];
    return {
      preuso: rows.filter((r) => r.tipo === 'pre_uso').length,
      semanal: rows.filter((r) => r.tipo === 'inspeccion').length,
    };
  }

  /** S32 — accidentes del conductor (para su perfil de actividad). Online. */
  async getAccidentesConductor(conductorId: string): Promise<FlotaAccidente[]> {
    const { data, error } = await this.supabase.client
      .from('vehiculo_accidentes')
      .select('id, fecha, fase, descripcion, lesionados, vehiculo:vehiculos(placa)')
      .eq('conductor_id', conductorId)
      .order('fecha', { ascending: false })
      .limit(50);
    if (error) return [];
    return ((data as unknown as FlotaAccidente[]) ?? []);
  }

  /** S22 — reporta un accidente del vehículo (con acta AMET opcional). */
  async enqueueAccidente(input: AccidenteCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.amet
      ? [{ id: crypto.randomUUID(), bucket: BUCKET_DOCS, path: `accidentes/${id}/amet.${input.amet.ext}`, slot: 'amet', blob: input.amet.blob }]
      : [];
    await this.sync.enqueue({
      id,
      tipo_op: 'accidente_vehiculo',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        fase: input.fase,
        descripcion: input.descripcion,
        lesionados: input.lesionados,
        tercero: input.tercero,
        gps: input.gps,
        capturado_en,
      },
      fotos,
      resumen: { tipo: 'accidente', vehiculo_id: input.vehiculoId, capturado_en },
    });
  }

  /** S22 — reporta un daño del vehículo (independiente de entregas). */
  async enqueueDano(input: DanoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.foto
      ? [{ id: crypto.randomUUID(), bucket: BUCKET_FOTOS, path: `danos/${id}/foto.jpg`, slot: 'foto', blob: input.foto }]
      : [];
    await this.sync.enqueue({
      id,
      tipo_op: 'dano_vehiculo',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        zona: input.zona,
        descripcion: input.descripcion,
        origen: input.origen,
        capturado_en,
      },
      fotos,
      resumen: { tipo: 'dano', vehiculo_id: input.vehiculoId, capturado_en },
    });
  }

  /** S24 — registra una multa del conductor. */
  async enqueueMulta(input: MultaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.documento
      ? [{ id: crypto.randomUUID(), bucket: BUCKET_DOCS, path: `multas/${id}/doc.${input.documento.ext}`, slot: 'doc', blob: input.documento.blob }]
      : [];
    await this.sync.enqueue({
      id,
      tipo_op: 'multa_conductor',
      capturado_en,
      payload: {
        id,
        conductor_id: input.conductorId,
        vehiculo_id: input.vehiculoId,
        motivo: input.motivo,
        monto: input.monto,
        estado: input.estado,
        capturado_en,
      },
      fotos,
      resumen: { tipo: 'multa', conductor_id: input.conductorId, capturado_en },
    });
  }

  private registerHandlers(): void {
    this.sync.register('accidente_vehiculo', async (payload, photoPaths) => {
      const gps = payload['gps'] as { lat: number; lng: number } | null;
      const { error } = await this.supabase.client.rpc('registrar_accidente_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_fecha: (payload['capturado_en'] as string).slice(0, 10),
        p_fase: payload['fase'],
        p_descripcion: payload['descripcion'] ?? null,
        p_lesionados: payload['lesionados'] ?? 0,
        p_tercero: payload['tercero'] ?? null,
        p_conductor_id: null,
        p_gps: gps ?? null,
        p_reporte_amet_path: photoPaths['amet'] ?? null,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('dano_vehiculo', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_dano_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_zona: payload['zona'] ?? null,
        p_descripcion: payload['descripcion'] ?? null,
        p_foto_path: photoPaths['foto'] ?? null,
        p_origen: payload['origen'] ?? 'desconocido',
        p_accidente_id: null,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('multa_conductor', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_multa_app', {
        p_id: payload['id'],
        p_conductor_id: payload['conductor_id'],
        p_fecha: (payload['capturado_en'] as string).slice(0, 10),
        p_motivo: payload['motivo'] ?? null,
        p_monto: payload['monto'] ?? null,
        p_vehiculo_id: payload['vehiculo_id'] ?? null,
        p_accidente_id: null,
        p_documento_path: photoPaths['doc'] ?? null,
        p_estado: payload['estado'] ?? 'pendiente',
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throwSyncError(error);
    });
  }
}
