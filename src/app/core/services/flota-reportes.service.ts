import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  AccidenteCaptura,
  ChecklistBreakdown,
  ChecklistDetalle,
  ChecklistRespuestaDetalle,
  DanoCaptura,
  EchadaDetalle,
  FlotaAccidente,
  FlotaEntrega,
  FlotaMulta,
  HistorialChecklist,
  HistorialEchada,
  MultaCaptura,
  RutaCreada,
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

  /** U11 — multas asociadas a un vehículo (para su perfil). Online. */
  async getMultasVehiculo(vehiculoId: string): Promise<FlotaMulta[]> {
    if (!vehiculoId) return [];
    const { data, error } = await this.supabase.client
      .from('conductor_multas')
      .select('id, fecha, motivo, monto, estado, created_at')
      .eq('vehiculo_id', vehiculoId)
      .order('fecha', { ascending: false })
      .limit(50);
    if (error) return [];
    return (data as FlotaMulta[]) ?? [];
  }

  /** U11 — último nivel de combustible registrado (cabecera de checklist/pre-uso). */
  async getUltimoNivelCombustible(vehiculoId: string): Promise<string | null> {
    if (!vehiculoId) return null;
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select('nivel_combustible, fecha, created_at')
      .eq('vehiculo_id', vehiculoId)
      .not('nivel_combustible', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { nivel_combustible: string | null }).nivel_combustible ?? null;
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

  /** V2 — fecha ISO (YYYY-MM-DD) de hace `dias` días, para acotar el historial. */
  private desdeISO(dias: number): string {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  }

  /**
   * V2 — historial navegable de MIS checklists por tipo (pre_uso | inspeccion),
   * últimos `dias` días. RLS ya scopea al conductor (o elevado). Online.
   */
  async getMisChecklists(
    conductorId: string,
    tipo: 'pre_uso' | 'inspeccion',
    dias = 90,
  ): Promise<HistorialChecklist[]> {
    if (!conductorId) return [];
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select('id, fecha, tipo, resultado, kilometraje, nivel_combustible, vehiculo:vehiculos(placa)')
      .eq('conductor_id', conductorId)
      .eq('tipo', tipo)
      .not('es_prueba', 'is', true) // V2 — ocultar registros de prueba (incluye NULL)
      .gte('fecha', this.desdeISO(dias))
      .order('fecha', { ascending: false })
      .limit(200);
    if (error) return [];
    return (data as unknown as HistorialChecklist[]) ?? [];
  }

  /** V2 — historial navegable de MIS echadas de combustible, últimos `dias` días. */
  async getMisEchadas(conductorId: string, dias = 90): Promise<HistorialEchada[]> {
    if (!conductorId) return [];
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select('id, fecha, kilometraje, galones, monto, rendimiento_km_gal, alerta_consumo, vehiculo:vehiculos(placa)')
      .eq('conductor_id', conductorId)
      .not('es_prueba', 'is', true) // V2 — ocultar echadas de prueba (incluye NULL)
      .gte('fecha', this.desdeISO(dias))
      .order('fecha', { ascending: false })
      .limit(200);
    if (error) return [];
    return (data as unknown as HistorialEchada[]) ?? [];
  }

  /**
   * V3 — rutas creadas por el usuario actual (roles elevados). La RLS de `rutas`
   * permite ver las propias por `creado_por`; se filtra por el uid del usuario.
   */
  async getMisRutasCreadas(dias = 90): Promise<RutaCreada[]> {
    const { data: auth } = await this.supabase.client.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return [];
    const { data, error } = await this.supabase.client
      .from('rutas')
      .select('id, fecha, origen, destino, estado, vehiculo:vehiculos(placa), conductor:conductores(nombre)')
      .eq('creado_por', uid)
      .not('es_prueba', 'is', true) // V3 — ocultar rutas de prueba (incluye NULL)
      .gte('fecha', this.desdeISO(dias))
      .order('fecha', { ascending: false })
      .limit(200);
    if (error) return [];
    return (data as unknown as RutaCreada[]) ?? [];
  }

  /** Firma un path del bucket `vehiculos` (fotos/firma). null si falla. */
  private async signedVehiculos(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /**
   * V2 (follow-up) — detalle completo de un checklist (pre-uso o semanal):
   * cabecera + respuestas + fotos + firma (URLs firmadas). RLS ya scopea al dueño.
   */
  async getMiChecklistDetalle(id: string): Promise<ChecklistDetalle | null> {
    if (!id) return null;
    const { data, error } = await this.supabase.client
      .from('checklists_vehiculo')
      .select(
        'id, tipo, fecha, resultado, kilometraje, nivel_combustible, observaciones, firma_path, ' +
          'vehiculo:vehiculos(placa, marca, modelo), conductor:conductores(nombre), ' +
          'respuestas:checklist_vehiculo_respuestas(etiqueta, seccion, es_critico, respuesta, comentario, orden), ' +
          'fotos:checklist_vehiculo_fotos(slot, storage_path)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as {
      id: string; tipo: string; fecha: string | null; resultado: string | null;
      kilometraje: number | null; nivel_combustible: string | null; observaciones: string | null;
      firma_path: string | null;
      vehiculo?: { placa: string; marca?: string; modelo?: string } | null;
      conductor?: { nombre: string } | null;
      respuestas?: ChecklistRespuestaDetalle[];
      fotos?: { slot: string; storage_path: string }[];
    };
    const respuestas = (row.respuestas ?? []).slice().sort((a, b) => a.orden - b.orden);
    const fotosRows = (row.fotos ?? []).filter((f) => !!f.storage_path);
    const fotos = (
      await Promise.all(
        fotosRows.map(async (f) => ({ slot: f.slot, url: await this.signedVehiculos(f.storage_path) })),
      )
    ).filter((f): f is { slot: string; url: string } => !!f.url);
    const firmaUrl = await this.signedVehiculos(row.firma_path);
    return {
      id: row.id, tipo: row.tipo, fecha: row.fecha, resultado: row.resultado,
      kilometraje: row.kilometraje, nivel_combustible: row.nivel_combustible,
      observaciones: row.observaciones, vehiculo: row.vehiculo ?? null, conductor: row.conductor ?? null,
      respuestas, fotos, firmaUrl,
    };
  }

  /** V2 (follow-up) — detalle de una echada + URLs firmadas de recibo/tablero. */
  async getMiEchadaDetalle(id: string): Promise<EchadaDetalle | null> {
    if (!id) return null;
    const { data, error } = await this.supabase.client
      .from('registros_combustible')
      .select(
        'id, fecha, kilometraje, km_anterior, km_recorridos, galones, monto, precio_por_galon, ' +
          'costo_por_km, rendimiento_km_gal, alerta_consumo, motivo_alerta, estacion, notas, ' +
          'foto_recibo_path, foto_tablero_path, vehiculo:vehiculos(placa, marca)',
      )
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as unknown as EchadaDetalle & { foto_recibo_path: string | null; foto_tablero_path: string | null };
    const [reciboUrl, tableroUrl] = await Promise.all([
      this.signedVehiculos(row.foto_recibo_path),
      this.signedVehiculos(row.foto_tablero_path),
    ]);
    return { ...row, reciboUrl, tableroUrl };
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
