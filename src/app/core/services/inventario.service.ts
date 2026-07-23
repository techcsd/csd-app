import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { ArticuloCat, Bodega, BodegaAdmin, CategoriaInv, Existencia } from '../models/inventario.model';
import { Conduce } from '../models/transporte.model';

const CAT_BODEGAS = 'bodegas';
// V14: bumped to _v2 to invalidate the pre-official-catalog offline cache
// (articles now carry requiere_talla/nota; categories are the official 8).
const CAT_ARTICULOS = 'articulos_v2';
const CAT_CATEGORIAS = 'categorias_inventario_v2';
const BUCKET = 'inventario';

export interface SalidaCaptura {
  bodegaId: string;
  proyectoId: string | null;
  motivo: string | null;
  items: { articulo_id: string; cantidad: number; talla?: string | null }[];
  foto: Blob | null;
}

export interface EntradaCaptura {
  bodegaId: string;
  referencia: string | null;
  /** B3/U25 — texto libre cuando el origen es "Otro" (se guarda en otros_valores). */
  otroReferencia?: string | null;
  items: { articulo_id: string; cantidad: number; talla?: string | null }[];
  foto: Blob | null;
}

export interface RecepcionCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  notas: string | null;
  foto: Blob | null;
}

export interface ConteoCaptura {
  bodegaId: string;
  motivo: string | null;
  items: { articulo_id: string; cantidad_contada: number }[];
}

/** P12 — obra de origen para una entrada por devolución de obra. */
export interface ObraOrigen {
  id: string;
  nombre: string;
  /** true si la obra tiene almacén propio (se puede descontar de él). */
  tieneBodega: boolean;
}

/** P12 — entrada por devolución de obra (con traspaso opcional del almacén). */
export interface DevolucionObraCaptura {
  bodegaDestinoId: string;
  origenProyectoId: string;
  /** Registrar también la SALIDA del almacén de la obra de origen. */
  descontar: boolean;
  referencia: string | null;
  items: { articulo_id: string; cantidad: number }[];
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

  /**
   * P12 — obras (proyectos) para el selector de "Devolución de obra", con un
   * flag `tieneBodega` (almacén de obra) para habilitar el traspaso. Cacheado
   * offline como los demás catálogos.
   */
  async getObrasConBodega(): Promise<ObraOrigen[]> {
    const data = await this.catalog.refresh<ObraOrigen[]>('obras_con_bodega', async () => {
      const [proys, bods] = await Promise.all([
        this.supabase.client.from('proyectos').select('id, nombre').order('nombre'),
        this.supabase.client.from('bodegas').select('proyecto_id').eq('activo', true).not('proyecto_id', 'is', null),
      ]);
      if (proys.error) throw new Error(proys.error.message);
      if (bods.error) throw new Error(bods.error.message);
      const conBodega = new Set(((bods.data as { proyecto_id: string }[]) ?? []).map((b) => b.proyecto_id));
      return ((proys.data as { id: string; nombre: string }[]) ?? []).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        tieneBodega: conBodega.has(p.id),
      }));
    });
    return data ?? [];
  }

  async getArticulos(): Promise<ArticuloCat[]> {
    const data = await this.catalog.refresh<ArticuloCat[]>(CAT_ARTICULOS, async () => {
      const { data, error } = await this.supabase.client
        .from('articulos')
        .select('id, nombre, codigo, unidad, categoria_id, requiere_talla, nota')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as ArticuloCat[]) ?? [];
    });
    return data ?? [];
  }

  /** Active article categories (R16), destacadas first, cached offline. */
  async getCategorias(): Promise<CategoriaInv[]> {
    const data = await this.catalog.refresh<CategoriaInv[]>(CAT_CATEGORIAS, async () => {
      const { data, error } = await this.supabase.client
        .from('categorias_inventario')
        .select('id, nombre, padre_id, orden, destacada')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as CategoriaInv[]) ?? [];
    });
    return data ?? [];
  }

  // ---- Gestión de almacenes (R12) — paridad con la web, gate por RLS (inventario) ----

  /** All warehouses incl. inactive, for the management screen. */
  async getBodegasAdmin(): Promise<BodegaAdmin[]> {
    const { data, error } = await this.supabase.client
      .from('bodegas')
      .select('id, nombre, descripcion, ubicacion, activo, es_principal')
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data as BodegaAdmin[]) ?? [];
  }

  /** Create a warehouse. Server trigger homologates the name (R18). */
  async crearBodega(input: { nombre: string; descripcion: string | null; ubicacion: string | null }): Promise<void> {
    const { error } = await this.supabase.client.from('bodegas').insert({
      nombre: input.nombre,
      descripcion: input.descripcion,
      ubicacion: input.ubicacion,
    });
    if (error) throw new Error(error.message);
    await this.refreshBodegas();
  }

  async actualizarBodega(
    id: string,
    input: { nombre: string; descripcion: string | null; ubicacion: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('bodegas')
      .update({ nombre: input.nombre, descripcion: input.descripcion, ubicacion: input.ubicacion })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.refreshBodegas();
  }

  async setBodegaActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('bodegas').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.refreshBodegas();
  }

  /** Re-warm the active-bodega cache used by salida/entrada pickers. */
  private async refreshBodegas(): Promise<void> {
    await this.catalog.refresh<Bodega[]>(CAT_BODEGAS, async () => {
      const { data, error } = await this.supabase.client
        .from('bodegas')
        .select('id, nombre')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as Bodega[]) ?? [];
    });
  }

  /**
   * W8 — stock EN VIVO de un artículo en una bodega (RPC stock_articulo_bodega).
   * Devuelve { cantidad, unidad } o null si no se pudo consultar (offline/error)
   * → la UI muestra "stock sin verificar" y NO bloquea el trabajo de campo.
   */
  async stockArticuloBodega(
    articuloId: string,
    bodegaId: string,
  ): Promise<{ cantidad: number; unidad: string } | null> {
    if (!articuloId || !bodegaId) return null;
    try {
      const { data, error } = await this.supabase.client.rpc('stock_articulo_bodega', {
        p_articulo_id: articuloId,
        p_bodega_id: bodegaId,
      });
      if (error) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { cantidad: 0, unidad: '' };
      return { cantidad: Number((row as { cantidad: number }).cantidad ?? 0), unidad: (row as { unidad: string }).unidad ?? '' };
    } catch {
      return null;
    }
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
        otro_referencia: input.otroReferencia ?? null,
        items: input.items,
        capturado_en,
      },
      fotos: this.fotoOf(id, input.foto),
      resumen: { tipo: 'entrada', capturado_en, items: input.items.length },
    });
  }

  /**
   * P12 — entrada por devolución de obra. Encola por outbox y, al sincronizar,
   * llama el RPC atómico `registrar_devolucion_obra`: si `descontar` y la obra
   * tiene almacén, registra en una transacción la SALIDA del almacén de la obra
   * + la ENTRADA en el almacén destino (enlazadas); si no, entrada simple con la
   * obra como referencia. El rechazo por stock insuficiente llega como error
   * permanente legible (FASE 1).
   */
  async enqueueDevolucionObra(input: DevolucionObraCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'inv_devolucion_obra',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_destino_id: input.bodegaDestinoId,
        origen_proyecto_id: input.origenProyectoId,
        descontar: input.descontar,
        referencia: input.referencia,
        items: input.items,
        capturado_en,
      },
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

  async enqueueConteo(input: ConteoCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'inv_conteo',
      capturado_en,
      payload: { id, bodega_id: input.bodegaId, motivo: input.motivo, items: input.items },
      resumen: { tipo: 'conteo', capturado_en, items: input.items.length },
    });
  }

  private fotoOf(id: string, foto: Blob | null) {
    return foto
      ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `${id}/evidencia.jpg`, slot: 'evidencia', blob: foto }]
      : [];
  }

  /**
   * B3/U25 — registra un valor de "Otro/s" en sgc.otros_valores con su contexto
   * (envoltura estructurada) para alimentar la inteligencia/autocompletado. Es
   * best-effort: cualquier error se ignora para no romper el sync del movimiento.
   */
  private async registrarOtroValor(
    contexto: string,
    valor: unknown,
    referenciaId: unknown,
  ): Promise<void> {
    const v = typeof valor === 'string' ? valor.trim() : '';
    if (!v) return;
    try {
      await this.supabase.client.rpc('registrar_otro_valor', {
        p_contexto: contexto,
        p_valor: v,
        p_referencia_id: (referenciaId as string) ?? null,
      });
    } catch {
      /* intelligence-only: never block the movement sync */
    }
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
      if (error) throwSyncError(error);
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
      if (error) throwSyncError(error);
      // B3/U25 — inteligencia de "Otro/s": registra el origen escrito a mano en
      // otros_valores (estructurado {contexto,valor}) para autocompletado futuro.
      // Best-effort: nunca falla el sync (la entrada ya quedó registrada).
      await this.registrarOtroValor('entrada_referencia', payload['otro_referencia'], payload['id']);
    });

    this.sync.register('inv_devolucion_obra', async (payload) => {
      const { error } = await this.supabase.client.rpc('registrar_devolucion_obra', {
        p_fecha: payload['fecha'],
        p_bodega_destino_id: payload['bodega_destino_id'],
        p_origen_proyecto_id: payload['origen_proyecto_id'],
        p_descontar: payload['descontar'] ?? false,
        p_referencia: payload['referencia'] ?? null,
        p_observaciones: null,
        p_creado_por: null, // el RPC usa auth.uid() por defecto
        p_items: payload['items'],
      });
      // Rechazo por stock insuficiente / obra sin almacén → P0001 permanente,
      // legible en "Pendientes de envío" (FASE 1).
      if (error) throwSyncError(error);
      // El stock cambió en ambas bodegas: invalida las existencias cacheadas.
      await this.catalog.invalidatePrefix('existencias_');
    });

    this.sync.register('conduce_recepcion', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('recibir_conduce_app', {
        p_salida_id: payload['salida_id'],
        p_items: payload['items'],
        p_notas: payload['notas'] ?? null,
        p_foto_path: photoPaths['recepcion'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('inv_conteo', async (payload) => {
      const { error } = await this.supabase.client.rpc('registrar_conteo_app', {
        p_id: payload['id'],
        p_bodega_id: payload['bodega_id'],
        p_motivo: payload['motivo'] ?? null,
        p_items: payload['items'],
      });
      if (error) throwSyncError(error);
    });
  }
}
