import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { PermanentSyncError, SyncService } from '../sync/sync.service';
import { ArticuloCat, Bodega, Existencia } from '../models/inventario.model';
import { Conduce } from '../models/transporte.model';

const CAT_BODEGAS = 'bodegas';
const CAT_ARTICULOS = 'articulos';
const BUCKET = 'inventario';

export interface SalidaCaptura {
  bodegaId: string;
  proyectoId: string | null;
  motivo: string | null;
  items: { articulo_id: string; cantidad: number }[];
  foto: Blob | null;
}

export interface EntradaCaptura {
  bodegaId: string;
  referencia: string | null;
  items: { articulo_id: string; cantidad: number }[];
  foto: Blob | null;
}

export interface RecepcionCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  notas: string | null;
  foto: Blob | null;
}

/**
 * Bodega stock reads (offline-cached) + salida/entrada writes through the
 * outbox. Commits via sgc.registrar_salida_app / registrar_entrada_app, which
 * fire SGC's stock triggers exactly as the web does.
 */
@Injectable({ providedIn: 'root' })
export class InventarioService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandlers();
  }

  async getBodegas(): Promise<Bodega[]> {
    const data = await this.catalog.refresh<Bodega[]>(CAT_BODEGAS, async () => {
      const { data, error } = await this.supabase.client
        .from('bodegas')
        .select('id, nombre')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Bodega[]) ?? [];
    });
    return data ?? [];
  }

  async getArticulos(): Promise<ArticuloCat[]> {
    const data = await this.catalog.refresh<ArticuloCat[]>(CAT_ARTICULOS, async () => {
      const { data, error } = await this.supabase.client
        .from('articulos')
        .select('id, nombre, codigo, unidad')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as ArticuloCat[]) ?? [];
    });
    return data ?? [];
  }

  async getExistencias(bodegaId: string): Promise<Existencia[]> {
    const key = `existencias_${bodegaId}`;
    const data = await this.catalog.refresh<Existencia[]>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('stock_por_bodega')
        .select('articulo_id, cantidad, articulo:articulos(nombre, codigo, unidad)')
        .eq('bodega_id', bodegaId);
      if (error) throw new Error(error.message);
      type Row = { articulo_id: string; cantidad: number; articulo: { nombre: string; codigo: string; unidad: string } | null };
      return ((data as unknown as Row[]) ?? []).map((r) => ({
        articulo_id: r.articulo_id,
        cantidad: Number(r.cantidad),
        nombre: r.articulo?.nombre ?? '—',
        codigo: r.articulo?.codigo ?? '',
        unidad: r.articulo?.unidad ?? '',
      }));
    });
    return data ?? [];
  }

  async enqueueSalida(input: SalidaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'inv_salida',
      capturado_en,
      payload: {
        id,
        bodega_id: input.bodegaId,
        proyecto_id: input.proyectoId,
        motivo: input.motivo,
        items: input.items,
        capturado_en,
      },
      fotos: this.fotoOf(id, input.foto),
      resumen: { tipo: 'salida', capturado_en, items: input.items.length },
    });
  }

  async enqueueEntrada(input: EntradaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'inv_entrada',
      capturado_en,
      payload: {
        id,
        bodega_id: input.bodegaId,
        referencia: input.referencia,
        items: input.items,
        capturado_en,
      },
      fotos: this.fotoOf(id, input.foto),
      resumen: { tipo: 'entrada', capturado_en, items: input.items.length },
    });
  }

  /** Dispatched conduces the user can receive (RLS scopes visibility). */
  async conducesPorRecibir(): Promise<Conduce[]> {
    const data = await this.catalog.refresh<Conduce[]>('conduces_recibir', async () => {
      const { data, error } = await this.supabase.client
        .from('salidas_inventario')
        .select('id, fecha, estado, proyecto:proyectos(nombre), bodega:bodegas(nombre), detalle_salidas(id, cantidad, articulo:articulos(nombre, unidad))')
        .eq('estado', 'despachado')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      type Row = {
        id: string; fecha: string; estado: string;
        proyecto: { nombre: string } | null; bodega: { nombre: string } | null;
        detalle_salidas: { id: string; cantidad: number; articulo: { nombre: string; unidad: string } | null }[];
      };
      return ((data as unknown as Row[]) ?? []).map((r) => ({
        id: r.id,
        fecha: r.fecha,
        estado: r.estado,
        destino: r.proyecto?.nombre ?? null,
        bodega: r.bodega?.nombre ?? null,
        items: (r.detalle_salidas ?? []).map((d) => ({
          detalle_id: d.id,
          articulo: d.articulo?.nombre ?? '—',
          unidad: d.articulo?.unidad ?? '',
          cantidad: Number(d.cantidad),
        })),
      }));
    });
    return data ?? [];
  }

  async enqueueRecepcion(input: RecepcionCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_recepcion',
      capturado_en,
      payload: { salida_id: input.salidaId, items: input.items, notas: input.notas },
      fotos: input.foto
        ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `recepcion/${id}.jpg`, slot: 'recepcion', blob: input.foto }]
        : [],
      resumen: { tipo: 'recepcion', salida_id: input.salidaId, capturado_en },
    });
    void this.conducesPorRecibir();
  }

  private fotoOf(id: string, foto: Blob | null) {
    return foto
      ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `${id}/evidencia.jpg`, slot: 'evidencia', blob: foto }]
      : [];
  }

  private registerHandlers(): void {
    this.sync.register('inv_salida', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_salida_app', {
        p_id: payload['id'],
        p_bodega_id: payload['bodega_id'],
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_motivo: payload['motivo'] ?? null,
        p_items: payload['items'],
        p_foto_path: photoPaths['evidencia'] ?? null,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throw new PermanentSyncError(error.message);
    });

    this.sync.register('inv_entrada', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('registrar_entrada_app', {
        p_id: payload['id'],
        p_bodega_id: payload['bodega_id'],
        p_referencia: payload['referencia'] ?? null,
        p_items: payload['items'],
        p_foto_path: photoPaths['evidencia'] ?? null,
        p_capturado_en: payload['capturado_en'],
      });
      if (error) throw new PermanentSyncError(error.message);
    });

    this.sync.register('conduce_recepcion', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('recibir_conduce_app', {
        p_salida_id: payload['salida_id'],
        p_items: payload['items'],
        p_notas: payload['notas'] ?? null,
        p_foto_path: photoPaths['recepcion'] ?? null,
      });
      if (error) throw new PermanentSyncError(error.message);
    });
  }
}
