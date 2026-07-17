import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import {
  AsignacionResultado,
  CombustibleNivel,
  DanoCaptura,
  EntregaTipo,
  FOTOS_REQUERIDAS,
  MiAsignacion,
  PendientesTransporte,
  VehiculoDetalle,
  VehiculoDisponible,
  VehiculoStats,
} from '../models/transporte.model';

const REQUIRED_SLOTS = FOTOS_REQUERIDAS.map((f) => f.slot);
const CATALOG_PENDIENTES = 'pendientes_transporte';
const CATALOG_VEH_DETALLE = 'veh_detalle'; // + `:${vehiculoId}`
const CATALOG_DISPONIBLES = 'vehiculos_disponibles';
const CATALOG_MIS_ASIGNACIONES = 'mis_asignaciones';

/** Editable vehicle fields for the admin create/edit form. */
export interface VehiculoEditable {
  placa: string;
  marca: string;
  modelo: string;
  anio: number;
  tipo: string;
  estado: string;
  kilometraje: number;
  vencimientoMatricula: string | null;
  vencimientoSeguro: string | null;
  kmUltimoMantenimiento: number | null;
  intervaloMantenimientoKm: number;
  notas: string | null;
}

/** A flota alert (avisos_flota) for the app's avisos screen. */
export interface FlotaAviso {
  id: string;
  tipo: string;
  vehiculo_id: string | null;
  conductor_id: string | null;
  mensaje: string | null;
  severidad: string | null;
  estado: string;
  created_at: string;
  vehiculo?: { placa: string; estado: string } | null;
}

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

  /** Minimal vehicle header for the checklist (placa/modelo/km + foto U6). */
  async getVehiculo(id: string): Promise<{
    id: string;
    placa: string;
    marca: string;
    modelo: string;
    kilometraje: number;
    foto_path: string | null;
  } | null> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('id, placa, marca, modelo, kilometraje, fotos')
      .eq('id', id)
      .single();
    if (error) {
      // Offline: fall back to whatever the pending list cached.
      const p = await this.catalog.read<PendientesTransporte>(CATALOG_PENDIENTES);
      const hit = [...(p?.a_cargo ?? []), ...(p?.por_recibir ?? [])].find(
        (v) => v.vehiculo_id === id,
      );
      return hit
        ? { id, placa: hit.placa, marca: hit.marca, modelo: hit.modelo, kilometraje: hit.km, foto_path: null }
        : null;
    }
    const v = data as unknown as {
      id: string;
      placa: string;
      marca: string;
      modelo: string;
      kilometraje: number;
      fotos: string[] | null;
    };
    return {
      id: v.id,
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      kilometraje: v.kilometraje,
      foto_path: (v.fotos ?? [])[0] ?? null,
    };
  }

  /**
   * Extended vehicle header for pre-use: expiry dates + maintenance interval,
   * cached per vehicle so licence/registration blocks and the maintenance line
   * keep working offline after the first online load.
   */
  async getVehiculoDetalle(id: string): Promise<VehiculoDetalle | null> {
    const data = await this.catalog.refresh<VehiculoDetalle>(
      `${CATALOG_VEH_DETALLE}:${id}`,
      async () => {
        const { data, error } = await this.supabase.client
          .from('vehiculos')
          .select(
            'id, placa, marca, modelo, tipo, kilometraje, vencimiento_matricula, vencimiento_seguro, km_ultimo_mantenimiento, intervalo_mantenimiento_km',
          )
          .eq('id', id)
          .single();
        if (error) throw new Error(error.message);
        return data as unknown as VehiculoDetalle;
      },
    );
    return data ?? null;
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

  /** Whole active fleet (any estado) for the browse/profile list, cached. */
  async getFlota(): Promise<VehiculoDisponible[]> {
    const data = await this.catalog.refresh<VehiculoDisponible[]>('flota_vehiculos', async () => {
      const { data, error } = await this.supabase.client
        .from('vehiculos')
        .select('id, placa, marca, modelo, tipo, kilometraje, estado, activo, fotos')
        .eq('activo', true)
        .order('placa', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as Array<Record<string, unknown>>) ?? []).map((v) => ({
        vehiculo_id: v['id'] as string,
        placa: v['placa'] as string,
        marca: (v['marca'] as string) ?? '',
        modelo: (v['modelo'] as string) ?? '',
        tipo: (v['tipo'] as string) ?? '',
        km: (v['kilometraje'] as number) ?? 0,
        foto_path: ((v['fotos'] as string[] | null) ?? [])[0] ?? null,
      }));
    });
    return data ?? [];
  }

  /** Vehicles available to self-assign (activo + estado disponible), cached. */
  async getVehiculosDisponibles(): Promise<VehiculoDisponible[]> {
    const data = await this.catalog.refresh<VehiculoDisponible[]>(CATALOG_DISPONIBLES, async () => {
      const { data, error } = await this.supabase.client
        .from('vehiculos')
        .select('id, placa, marca, modelo, tipo, kilometraje, estado, activo, fotos')
        .eq('activo', true)
        .not('estado', 'in', '(baja,no_disponible)')
        .order('placa', { ascending: true });
      if (error) throw new Error(error.message);
      return ((data as Array<Record<string, unknown>>) ?? []).map((v) => ({
        vehiculo_id: v['id'] as string,
        placa: v['placa'] as string,
        marca: (v['marca'] as string) ?? '',
        modelo: (v['modelo'] as string) ?? '',
        tipo: (v['tipo'] as string) ?? '',
        km: (v['kilometraje'] as number) ?? 0,
        foto_path: ((v['fotos'] as string[] | null) ?? [])[0] ?? null,
      }));
    });
    return data ?? [];
  }

  /** U6 — foto_path (primera) por vehículo, para pintar fotos en listas. */
  async getFotosPaths(ids: string[]): Promise<Record<string, string | null>> {
    const map: Record<string, string | null> = {};
    if (!ids.length) return map;
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select('id, fotos')
      .in('id', ids);
    if (error) return map;
    for (const v of (data as Array<{ id: string; fotos: string[] | null }>) ?? []) {
      map[v.id] = (v.fotos ?? [])[0] ?? null;
    }
    return map;
  }

  /** U6 — signed URL for a vehicle photo in the `vehiculos` bucket (or null). */
  async getFotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from('vehiculos')
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  /** The user's active assignments (vehiculo_asignaciones), cached for offline. */
  async getMisAsignaciones(): Promise<MiAsignacion[]> {
    const data = await this.catalog.refresh<MiAsignacion[]>(CATALOG_MIS_ASIGNACIONES, async () => {
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return [];
      const { data, error } = await this.supabase.client
        .from('vehiculo_asignaciones')
        .select(
          'id, desde, origen, vehiculo:vehiculos(id, placa, marca, modelo, tipo, kilometraje)',
        )
        .eq('usuario_id', uid)
        .eq('activa', true)
        .order('desde', { ascending: false });
      if (error) throw new Error(error.message);
      return ((data as Array<Record<string, unknown>>) ?? [])
        .filter((r) => r['vehiculo'])
        .map((r) => {
          const v = r['vehiculo'] as Record<string, unknown>;
          return {
            asignacion_id: r['id'] as string,
            vehiculo_id: v['id'] as string,
            placa: v['placa'] as string,
            marca: (v['marca'] as string) ?? '',
            modelo: (v['modelo'] as string) ?? '',
            tipo: (v['tipo'] as string) ?? '',
            km: (v['kilometraje'] as number) ?? 0,
            desde: r['desde'] as string,
            origen: (r['origen'] as string) ?? 'auto',
          };
        });
    });
    return data ?? [];
  }

  /**
   * Self-assign a vehicle (online). Returns the data needed to chain straight
   * into the recepción checklist. Idempotent server-side via the client UUID.
   */
  async asignarme(vehiculoId: string, clientUuid?: string): Promise<AsignacionResultado> {
    const { data, error } = await this.supabase.client.rpc('asignarme_vehiculo', {
      p_vehiculo_id: vehiculoId,
      p_client_uuid: clientUuid ?? crypto.randomUUID(),
    });
    if (error) throw new Error(error.message);
    // The pending/assignment lists changed; refresh best-effort.
    void this.misPendientes();
    void this.getMisAsignaciones();
    return data as AsignacionResultado;
  }

  /** Aggregated vehicle stats for the read-only profile (R4), cached offline. */
  async getVehiculoStats(id: string): Promise<VehiculoStats | null> {
    const data = await this.catalog.refresh<VehiculoStats | null>(`veh_stats:${id}`, async () => {
      const { data, error } = await this.supabase.client
        .from('v_vehiculo_stats')
        .select('*')
        .eq('vehiculo_id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as VehiculoStats) ?? null;
    });
    return data ?? null;
  }

  // ---- Gestión de vehículos (admin, RLS vehiculos:write = is_admin) ----

  /** Full editable vehicle row for the admin form (online). */
  async getVehiculoFull(id: string): Promise<(VehiculoEditable & { id: string; fotos: string[] }) | null> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .select(
        'id, placa, marca, modelo, anio, tipo, estado, kilometraje, vencimiento_matricula, vencimiento_seguro, km_ultimo_mantenimiento, intervalo_mantenimiento_km, notas, fotos',
      )
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    const v = data as unknown as Record<string, unknown>;
    return {
      id: v['id'] as string,
      placa: (v['placa'] as string) ?? '',
      marca: (v['marca'] as string) ?? '',
      modelo: (v['modelo'] as string) ?? '',
      anio: (v['anio'] as number) ?? new Date().getFullYear(),
      tipo: (v['tipo'] as string) ?? '',
      estado: (v['estado'] as string) ?? 'activo',
      kilometraje: (v['kilometraje'] as number) ?? 0,
      vencimientoMatricula: (v['vencimiento_matricula'] as string) ?? null,
      vencimientoSeguro: (v['vencimiento_seguro'] as string) ?? null,
      kmUltimoMantenimiento: (v['km_ultimo_mantenimiento'] as number) ?? null,
      intervaloMantenimientoKm: (v['intervalo_mantenimiento_km'] as number) ?? 5000,
      notas: (v['notas'] as string) ?? null,
      fotos: (v['fotos'] as string[]) ?? [],
    };
  }

  private toRow(input: VehiculoEditable): Record<string, unknown> {
    return {
      placa: input.placa.trim(),
      marca: input.marca.trim(),
      modelo: input.modelo.trim(),
      anio: input.anio,
      tipo: input.tipo.trim(),
      estado: input.estado,
      kilometraje: input.kilometraje,
      vencimiento_matricula: input.vencimientoMatricula || null,
      vencimiento_seguro: input.vencimientoSeguro || null,
      km_ultimo_mantenimiento: input.kmUltimoMantenimiento,
      intervalo_mantenimiento_km: input.intervaloMantenimientoKm,
      notas: input.notas?.trim() || null,
    };
  }

  /** Create a vehicle (admin). Returns the new id. */
  async crearVehiculo(input: VehiculoEditable): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('vehiculos')
      .insert({ ...this.toRow(input), activo: true })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    await this.getFlota();
    return (data as { id: string }).id;
  }

  /** Update a vehicle (admin). */
  async actualizarVehiculo(id: string, input: VehiculoEditable): Promise<void> {
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update({ ...this.toRow(input), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.getFlota();
  }

  /** Upload a vehicle photo to the `vehiculos` bucket and make it the primary. */
  async subirFotoVehiculo(id: string, blob: Blob): Promise<void> {
    const path = `${id}/perfil_${crypto.randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.client.storage
      .from('vehiculos')
      .upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
    if (upErr) throw new Error(upErr.message);
    // Prepend the new photo as the primary (keep existing ones).
    const { data } = await this.supabase.client.from('vehiculos').select('fotos').eq('id', id).single();
    const fotos = ((data as { fotos: string[] } | null)?.fotos ?? []).filter((p) => p !== path);
    const { error } = await this.supabase.client
      .from('vehiculos')
      .update({ fotos: [path, ...fotos] })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.getFlota();
  }

  /**
   * Assign a vehicle to another driver (admin/flota). Deactivates other active
   * assignments for that vehicle and inserts a new active one (clean handoff).
   */
  async asignarAConductor(vehiculoId: string, conductorId: string, usuarioId: string | null): Promise<void> {
    await this.supabase.client
      .from('vehiculo_asignaciones')
      .update({ activa: false, hasta: new Date().toISOString() })
      .eq('vehiculo_id', vehiculoId)
      .eq('activa', true);
    const { error } = await this.supabase.client.from('vehiculo_asignaciones').insert({
      vehiculo_id: vehiculoId,
      conductor_id: conductorId,
      usuario_id: usuarioId,
      activa: true,
      origen: 'admin',
    });
    if (error) throw new Error(error.message);
    void this.misPendientes();
    void this.getMisAsignaciones();
  }

  // ---- Avisos de flota (R6/R9) ----

  /** Pending flota alerts (pre-cita, seguro/matrícula, hallazgos…), cached. */
  async getAvisosFlota(): Promise<FlotaAviso[]> {
    const data = await this.catalog.refresh<FlotaAviso[]>('avisos_flota', async () => {
      const { data, error } = await this.supabase.client
        .from('avisos_flota')
        .select('id, tipo, vehiculo_id, conductor_id, mensaje, severidad, estado, created_at, vehiculo:vehiculos(placa, estado)')
        .eq('estado', 'pendiente')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(error.message);
      return (data as unknown as FlotaAviso[]) ?? [];
    });
    return data ?? [];
  }

  /** Reactivate a vehicle marked no_disponible + close its blocking alert (R6). */
  async reactivarVehiculo(id: string, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('reactivar_vehiculo', { p_id: id, p_nota: nota ?? null });
    if (error) throw new Error(error.message);
    await this.getFlota();
    await this.getAvisosFlota();
  }

  /** Mark any flota alert as attended (admin/flota). */
  async atenderAviso(id: string, nota: string | null): Promise<void> {
    const { data: userData } = await this.supabase.client.auth.getUser();
    const { error } = await this.supabase.client
      .from('avisos_flota')
      .update({
        estado: 'atendido',
        atendido_por: userData.user?.id ?? null,
        atendido_at: new Date().toISOString(),
        nota_atencion: nota?.trim() || 'Atendido desde la app',
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.getAvisosFlota();
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
