import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { CatalogService } from '../sync/catalog.service';
import { AudioNotasService, AudioNotaMeta, AUDIO_BUCKET_FLOTA } from './audio-notas.service';

/**
 * X6-app / AG9 — tipos de visita/mantenimiento, EXACTAMENTE los que acepta el
 * servidor (`crear_mantenimiento_app`). Cualquier otro valor el RPC lo coerce a
 * 'preventivo'. AG9 agregó 'otros' (tintado / servicios varios).
 */
export type MantenimientoTipo =
  | 'preventivo'
  | 'falla'
  | 'accidente_dano'
  | 'cambio_pieza'
  | 'engrase'
  | 'hidraulico'
  | 'reparacion'
  | 'tintado'
  | 'bombillo'
  | 'neumatico'
  | 'bateria'
  | 'lavado'
  | 'otros';

/** AG9/AL7 — etiqueta en español RD por tipo (para listar el historial en la app). */
export const MANTENIMIENTO_TIPO_LABEL: Record<MantenimientoTipo, string> = {
  preventivo: 'Mantenimiento de rutina',
  falla: 'Falla / avería',
  accidente_dano: 'Daño por accidente',
  cambio_pieza: 'Cambio de pieza',
  engrase: 'Engrase',
  hidraulico: 'Hidráulico',
  reparacion: 'Reparación',
  tintado: 'Tintado de cristales',
  bombillo: 'Cambio de bombillo',
  neumatico: 'Neumáticos / gomas',
  bateria: 'Batería',
  lavado: 'Lavado',
  otros: 'Otros servicios',
};

/** AG9 — una fila del historial de mantenimientos de un vehículo (mantenimientos_por_vehiculo). */
export interface MantenimientoItem {
  id: string;
  tipo: MantenimientoTipo;
  descripcion: string | null;
  fecha: string;
  estado: 'pendiente' | 'en_proceso' | 'completado';
  costo: number | null;
  proveedor: string | null;
  kilometraje: number | null;
  notas: string | null;
  fotos: string[] | null;
  incluye_preventivo: boolean;
  created_at: string;
  /** AL7 — quién registró el mantenimiento (chofer o flota). */
  creado_por?: string | null;
  registrado_por?: string | null;
}

/** AG9 — input del cierre de mantenimiento (costo + evidencia) desde la app. */
export interface MantenimientoCierre {
  id: string; // id del mantenimiento a cerrar
  km: number | null;
  costo: number | null;
  proveedor: string | null;
  notas: string | null;
  fotos: Blob[];
  placa: string;
  vehiculoId: string;
}

/** Input the maintenance wizard hands to enqueueMantenimiento(). */
export interface MantenimientoCaptura {
  vehiculoId: string;
  tipo: MantenimientoTipo;
  descripcion: string;
  fecha: string; // YYYY-MM-DD
  km: number | null;
  /** X6-app — en visitas NO preventivas, si de paso se hizo preventivo. */
  incluyePreventivo: boolean;
  /** AL7 — costo opcional del trabajo. */
  costo?: number | null;
  /** AL7 — taller/proveedor donde se hizo. */
  proveedor?: string | null;
  /** AL7 — notas del trabajo (aparte de la descripción). */
  notas?: string | null;
  /** Up to 3 optional evidence photos, in capture order. */
  fotos: Blob[];
  /** Z23 — notas de voz múltiples (opcional). */
  voces?: Blob[];
  placa: string;
  /** AG15 — si nace de una tarea vinculada, su id (se enlaza al crear). */
  tareaVinculada?: string | null;
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
    this.registerCierreHandler();
  }

  /**
   * AG9 — historial de mantenimientos de un vehículo (próximos/en curso/historial se
   * derivan en la UI de estado+fecha). Cacheado (read-through) para verse offline.
   */
  async mantenimientosPorVehiculo(vehiculoId: string): Promise<MantenimientoItem[]> {
    const key = `mant_veh:${vehiculoId}`;
    const data = await this.catalog.refresh<MantenimientoItem[]>(key, async () => {
      const { data, error } = await this.supabase.client.rpc('mantenimientos_por_vehiculo', {
        p_vehiculo_id: vehiculoId,
      });
      if (error) throw error;
      return (data as MantenimientoItem[]) ?? [];
    });
    return data ?? [];
  }

  /** AG9 — encola el CIERRE de un mantenimiento (costo/proveedor/notas + evidencia). */
  async enqueueCierre(input: MantenimientoCierre): Promise<void> {
    const capturado_en = new Date().toISOString();
    const fotos = input.fotos.map((blob, idx) => ({
      id: crypto.randomUUID(),
      bucket: 'vehiculos',
      path: `mantenimiento/${input.id}/cierre_${idx}.jpg`,
      slot: `cierre_${idx}`,
      blob,
    }));
    await this.sync.enqueue({
      id: `cierre_${input.id}`, // idempotencia: un cierre por mantenimiento
      tipo_op: 'mantenimiento_cierre',
      capturado_en,
      payload: {
        id: input.id,
        vehiculo_id: input.vehiculoId,
        km: input.km,
        costo: input.costo,
        proveedor: input.proveedor,
        notas: input.notas,
      },
      fotos,
      resumen: { placa: input.placa, capturado_en },
    });
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
        costo: input.costo ?? null, // AL7
        proveedor: input.proveedor ?? null, // AL7 (taller)
        notas: input.notas ?? null, // AL7
        audios: audio.audios, // Z23
        tarea_vinculada: input.tareaVinculada ?? null, // AG15
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
        p_costo: payload['costo'] ?? null, // AL7
        p_proveedor: payload['proveedor'] ?? null, // AL7
        p_notas: payload['notas'] ?? null, // AL7
      });
      // A returned error is a server rejection (validation) → don't retry forever.
      if (error) throwSyncError(error);

      // Z23 — registrar las notas de voz (idempotente por path).
      await this.audioNotas.commit('mantenimiento', payload['id'] as string, payload['audios'] as AudioNotaMeta[] | undefined, photoPaths);

      // AG15 — si el mantenimiento nace de una tarea vinculada, enlázala (la tarea
      // se completa sola al cerrarse el mantenimiento). Idempotente.
      const tareaVinc = payload['tarea_vinculada'] as string | null;
      if (tareaVinc) {
        const { error: eV } = await this.supabase.client.rpc('vincular_tarea_entidad', {
          p_tarea_id: tareaVinc,
          p_tipo: 'mantenimiento',
          p_entity_id: payload['id'],
        });
        if (eV) throwSyncError(eV);
      }

      // P7 — el RPC avanza vehiculos.kilometraje; invalidar caches con km.
      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate(`mant_veh:${vehId}`); // AG9 — refrescar el historial
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones'); // AF21
    });
  }

  /** AG9 — handler del cierre: completar_mantenimiento_app (costo + evidencia). */
  private registerCierreHandler(): void {
    this.sync.register('mantenimiento_cierre', async (payload, photoPaths) => {
      const fotos = Object.entries(photoPaths).map(([slot, path]) => ({ storage_path: path, slot }));
      const { error } = await this.supabase.client.rpc('completar_mantenimiento_app', {
        p_id: payload['id'],
        p_km: payload['km'] ?? null,
        p_costo: payload['costo'] ?? null,
        p_proveedor: payload['proveedor'] ?? null,
        p_notas: payload['notas'] ?? null,
        p_fotos: fotos,
      });
      if (error) throwSyncError(error);

      const vehId = payload['vehiculo_id'] as string;
      await this.catalog.invalidate(`veh_detalle:${vehId}`);
      await this.catalog.invalidate(`mant_veh:${vehId}`);
      await this.catalog.invalidate('pendientes_transporte');
      await this.catalog.invalidate('flota_vehiculos');
      await this.catalog.invalidate('mis_asignaciones');
    });
  }
}
