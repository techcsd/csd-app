import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Conduce, RutaHoy } from '../models/transporte.model';
import { Proyecto } from '../models/bitacora.model';

const CATALOG_CONDUCES = 'mis_conduces';
const CATALOG_RUTAS = 'mis_rutas';
const CATALOG_PROYECTOS = 'proyectos';

/** Delivery capture the conduce screen hands to entregarConduce(). */
export interface ConduceEntregaCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  receptor: string;
  notas: string | null;
  fotoEntrega: Blob;
  firma: Blob;
}

/** New-route capture the crear-ruta wizard hands to crearRuta(). */
export interface RutaCaptura {
  vehiculoId: string;
  origen: string;
  destino: string;
  fecha: string;
  destinoProyectoId: string | null;
  kmEstimado: number | null;
  notas: string | null;
  origen_lat: number | null;
  origen_lng: number | null;
}

/**
 * Driver's conduces (dispatched material) + routes. Delivery confirmation is
 * enqueued offline and committed via sgc.entregar_conduce, closing SGC's
 * existing despachado → entregado / entregado_incompleto trazabilidad.
 */
@Injectable({ providedIn: 'root' })
export class ConducesService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  async misConduces(): Promise<Conduce[]> {
    const data = await this.catalog.refresh<Conduce[]>(CATALOG_CONDUCES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_conduces_hoy');
      if (error) throw new Error(error.message);
      return (data as Conduce[]) ?? [];
    });
    return data ?? [];
  }

  async misRutas(): Promise<RutaHoy[]> {
    const data = await this.catalog.refresh<RutaHoy[]>(CATALOG_RUTAS, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_rutas_hoy');
      if (error) throw new Error(error.message);
      return (data as RutaHoy[]) ?? [];
    });
    return data ?? [];
  }

  /** Obras/proyectos for the route destination picker (shared cache). */
  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>(CATALOG_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre')
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** Queue a new route (R7). Offline-safe via the outbox; idempotent by UUID. */
  async crearRuta(input: RutaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'crear_ruta',
      capturado_en,
      payload: {
        id,
        vehiculo_id: input.vehiculoId,
        origen: input.origen,
        destino: input.destino,
        fecha: input.fecha,
        destino_proyecto_id: input.destinoProyectoId,
        km_estimado: input.kmEstimado,
        notas: input.notas,
        origen_lat: input.origen_lat,
        origen_lng: input.origen_lng,
        capturado_en,
      },
      resumen: { origen: input.origen, destino: input.destino, fecha: input.fecha, capturado_en },
    });
    void this.misRutas();
  }

  async marcarRuta(rutaId: string, estado: 'en_curso' | 'completada' | 'cancelada'): Promise<void> {
    const { error } = await this.supabase.client.rpc('marcar_ruta_estado', {
      p_ruta_id: rutaId,
      p_estado: estado,
    });
    if (error) throw new Error(error.message);
    void this.misRutas();
  }

  /** Queue a conduce delivery (photo + receiver + signature). Offline-safe. */
  async entregarConduce(input: ConduceEntregaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();

    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_entrega',
      capturado_en,
      payload: {
        salida_id: input.salidaId,
        items: input.items,
        receptor: input.receptor,
        notas: input.notas,
      },
      fotos: [
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-entrega.jpg`,
          slot: 'entrega',
          blob: input.fotoEntrega,
        },
        {
          id: crypto.randomUUID(),
          bucket: 'conduces',
          path: `${input.salidaId}/${id}-firma.png`,
          slot: 'firma',
          blob: input.firma,
        },
      ],
      resumen: { salida_id: input.salidaId, receptor: input.receptor, capturado_en },
    });

    void this.misConduces();
  }

  private registerHandler(): void {
    this.sync.register('crear_ruta', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_ruta_app', {
        p_id: payload['id'],
        p_vehiculo_id: payload['vehiculo_id'],
        p_conductor_id: null,
        p_origen: payload['origen'],
        p_destino: payload['destino'],
        p_fecha: payload['fecha'],
        p_km_estimado: payload['km_estimado'] ?? null,
        p_notas: payload['notas'] ?? null,
        p_destino_proyecto_id: payload['destino_proyecto_id'] ?? null,
        p_destino_lat: null,
        p_destino_lng: null,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('conduce_entrega', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('entregar_conduce', {
        p_salida_id: payload['salida_id'],
        p_items: payload['items'],
        p_receptor: payload['receptor'],
        p_firma_url: photoPaths['firma'],
        p_foto_url: photoPaths['entrega'],
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
