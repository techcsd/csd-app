import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { ArticuloCat, Bodega, BodegaAdmin, BodegaUbicacion, CategoriaInv, CompraFerreteriaCaptura, ConteoHistorial, Existencia, Ferreteria, MaterialNoCatalogado } from '../models/inventario.model';
import { Conduce } from '../models/transporte.model';

const CAT_BODEGAS = 'bodegas';
// V14: bumped to _v2 to invalidate the pre-official-catalog offline cache
// (articles now carry requiere_talla/nota; categories are the official 8).
// Z16/Z17: bump a _v3 para traer propiedad + imagen_url.
const CAT_ARTICULOS = 'articulos_v3';
const CAT_CATEGORIAS = 'categorias_inventario_v2';
const BUCKET = 'inventario';

export interface SalidaCaptura {
  bodegaId: string;
  proyectoId: string | null;
  motivo: string | null;
  items: { articulo_id: string; cantidad: number; talla?: string | null }[];
  foto: Blob | null;
  /** AF10 — firma de quien ENTREGA el material. */
  firma?: Blob | null;
}

export interface EntradaCaptura {
  bodegaId: string;
  referencia: string | null;
  /** B3/U25 — texto libre cuando el origen es "Otro" (se guarda en otros_valores). */
  otroReferencia?: string | null;
  items: { articulo_id: string; cantidad: number; talla?: string | null }[];
  foto: Blob | null;
  /** AF10 — firma de quien RECIBE el material. */
  firma?: Blob | null;
}

/** AF13 — línea del checklist de recepción (recibido vs enviado). */
export interface RecepcionChecklistItem {
  nombre: string;
  cantidad_enviada: number;
  cantidad_recibida: number;
  diferencia: number;
}

export interface RecepcionCaptura {
  salidaId: string;
  items: { detalle_id: string; cantidad_recibida: number }[];
  notas: string | null;
  /** AF30 — fotos de evidencia de la descarga (mínimo 2, solo cámara). */
  fotos: Blob[];
  /** AF13 — checklist recibido vs enviado (para el registro de confirmación). */
  checklist?: RecepcionChecklistItem[];
  /** AE — firma del receptor (prueba de recepción, AC7) + su nombre. */
  firmaReceptor?: Blob | null;
  receptorNombre?: string | null;
}

/** AE — un ítem propuesto de una compra de ferretería pendiente de confirmar. */
export interface EntradaFerreteriaItem {
  articulo_id: string;
  nombre: string;
  unidad: string | null;
  cantidad: number;
}
/** AE — compra de ferretería del chofer pendiente de dar entrada (recibir). */
export interface EntradaFerreteriaPendiente {
  id: string;
  fecha: string;
  referencia: string | null;
  observaciones: string | null;
  bodega: string | null;
  bodega_id: string;
  obra: string | null;
  proyecto_id: string | null;
  foto_path: string | null;
  items: EntradaFerreteriaItem[];
}

/** AE — devolución de material (obra→almacén) por el chofer, con doble firma. */
export interface DevolucionChoferCaptura {
  bodegaDestinoId: string;
  origenProyectoId: string;
  referencia: string | null;
  observaciones: string | null;
  items: { articulo_id: string; cantidad: number }[];
  emisorNombre: string;
  firmaEmisor: Blob;
  /** Receptor: presente (firma ahora) o asignado para firmar después. */
  receptorNombre: string | null;
  receptorUsuarioId: string | null;
  firmaReceptor: Blob | null;
  /** AE8 — el chofer no recibe él mismo: la firma de recibido queda PENDIENTE
   *  para que Almacén (módulo inventario) la confirme. */
  confirmarPorAlmacen?: boolean;
}

/** AE — un ítem de una firma pendiente (bandeja "Por firmar"). */
export interface FirmaPendienteItem {
  articulo: string;
  unidad: string | null;
  cantidad: number;
}
/** AE — una entrega con la firma del RECEPTOR pendiente asignada a mí. */
export interface FirmaPendiente {
  salida_id: string;
  fecha: string;
  motivo: string | null;
  obra: string | null;
  proyecto_id: string | null;
  emisor: string | null;
  items: FirmaPendienteItem[];
  /** AE8 — true si está pendiente de confirmación por ALMACÉN (cola compartida),
   *  no asignada a una persona. La app la etiqueta distinto. */
  pendiente_almacen?: boolean;
}

/** AE — un usuario elegible como receptor (buscador). */
export interface UsuarioBusqueda {
  id: string;
  nombre: string;
  email: string | null;
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

/** AP2 — un artículo en la vista de inventario de un almacén. */
export interface InventarioAlmacenItem {
  articulo_id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad: string;
  propiedad: string | null;
  cantidad: number;
  apertura: number;
  es_cero: boolean;
  es_prueba: boolean;
}

/** AP3 — un movimiento del kardex (sketch: Mov|Origen|Destino|Fecha|Entrega|Recibe|Transporte|Conduce). */
export interface KardexMovimiento {
  mov: 'entrada' | 'salida' | 'ajuste';
  referencia_id: string;
  referencia_tipo: string;
  conduce_id: string | null;
  conduce_numero: string | null;
  fecha: string;
  ts: string;
  cantidad: number;
  delta: number;
  saldo: number;
  origen: string | null;
  destino: string | null;
  entrega_nombre: string | null;
  recibe_nombre: string | null;
  transporte_nombre: string | null;
  conductor_id: string | null;
  firmas: { rol?: string; nombre?: string; firma_path?: string; firmado_en?: string }[];
  fotos: string[];
}

/** AP3 — kardex de un artículo en un almacén (movimientos + serie del stock). */
export interface Kardex {
  apertura: number;
  saldo_actual: number;
  serie: { ts: string; saldo: number }[];
  movimientos: KardexMovimiento[];
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
      // AF11-bug — leer proyectos directo devolvía [] a usuarios de inventario/chofer
      // (la RLS de `proyectos` no incluye el módulo inventario). Se usa un RPC
      // security-definer que respeta activo + aísla proyectos de prueba.
      const { data, error } = await this.supabase.client.rpc('obras_con_bodega');
      if (error) throw new Error(error.message);
      return ((data as { id: string; nombre: string; tiene_bodega: boolean }[]) ?? []).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        tieneBodega: p.tiene_bodega,
      }));
    });
    return data ?? [];
  }

  /**
   * AP1 — obras para el selector de DESTINO del conduce/ruta. Va por el directorio
   * de referencia SECURITY DEFINER (`directorio_proyectos`), desacoplado del módulo
   * Proyectos: el chofer veía "No hay opciones." porque `obras_con_bodega` le
   * devolvía [] (RLS frágil). El directorio expone id/nombre (+lat/lng para fijar
   * coordenadas) sin financieros y respeta activo/es_prueba. El destino de obra no
   * requiere `tieneBodega` (cualquier obra activa es destino válido).
   */
  async getObrasDestino(): Promise<ObraOrigen[]> {
    const data = await this.catalog.refresh<ObraOrigen[]>('obras_destino', async () => {
      const { data, error } = await this.supabase.client.rpc('directorio_proyectos');
      if (error) throw new Error(error.message);
      return ((data as { id: string; nombre: string }[]) ?? []).map((p) => ({
        id: p.id,
        nombre: p.nombre,
        tieneBodega: true,
      }));
    });
    return data ?? [];
  }

  async getArticulos(): Promise<ArticuloCat[]> {
    const data = await this.catalog.refresh<ArticuloCat[]>(CAT_ARTICULOS, async () => {
      const { data, error } = await this.supabase.client
        .from('articulos')
        .select('id, nombre, codigo, unidad, categoria_id, requiere_talla, nota, propiedad, imagen_url')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as ArticuloCat[]) ?? [];
    });
    return data ?? [];
  }

  /** Z17 — un artículo por id (desde la caché de artículos), o null. */
  async getArticulo(id: string): Promise<ArticuloCat | null> {
    const list = await this.getArticulos();
    return list.find((a) => a.id === id) ?? null;
  }

  // ── AS20 — edición de artículos desde la app (admin + módulo inventario) ─────
  /**
   * AS20 — sube una imagen de catálogo al bucket PÚBLICO `sgc-articulos` y devuelve
   * su URL pública (la app pinta `imagen_url` como src directo). Online (editar el
   * catálogo no es trabajo de campo). El gate de escritura lo aplica la RLS del
   * bucket (admin/módulo inventario).
   */
  async subirImagenArticulo(articuloId: string, blob: Blob): Promise<string> {
    const path = `${articuloId}/${crypto.randomUUID()}.jpg`;
    const { error } = await this.supabase.client.storage
      .from('sgc-articulos')
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (error) throw new Error(error.message);
    const { data } = this.supabase.client.storage.from('sgc-articulos').getPublicUrl(path);
    return data.publicUrl;
  }

  /** AS20 — unidades de medida (catálogo). */
  async getUnidades(): Promise<{ id: string; codigo: string; nombre: string }[]> {
    const data = await this.catalog.refresh<{ id: string; codigo: string; nombre: string }[]>('unidades_v1', async () => {
      const { data, error } = await this.supabase.client
        .from('unidades')
        .select('id, codigo, nombre')
        .eq('activo', true)
        .order('nombre');
      if (error) throw new Error(error.message);
      return (data as { id: string; codigo: string; nombre: string }[]) ?? [];
    });
    return data ?? [];
  }

  /** AS20 — crea una categoría de inventario → id. */
  async crearCategoria(nombre: string, destacada = false): Promise<number> {
    const { data, error } = await this.supabase.client.rpc('crear_categoria_app', { p_nombre: nombre, p_destacada: destacada });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix(CAT_CATEGORIAS);
    await this.getCategorias();
    return data as number;
  }

  /** AS20 — crea una unidad de medida → id. */
  async crearUnidad(nombre: string, codigo?: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('crear_unidad_app', { p_nombre: nombre, p_codigo: codigo ?? null });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix('unidades_v1');
    await this.getUnidades();
    return data as string;
  }

  /** AS20 — crea un artículo (código auto CSD-<orden>-<seq>) → { id, codigo }. */
  async crearArticulo(input: { nombre: string; categoriaId: number; unidad?: string; propiedad?: string; nota?: string }): Promise<{ id: string; codigo: string }> {
    const { data, error } = await this.supabase.client.rpc('crear_articulo_app', {
      p_nombre: input.nombre,
      p_categoria_id: input.categoriaId,
      p_unidad: input.unidad ?? null,
      p_propiedad: input.propiedad ?? 'propio_csd',
      p_nota: input.nota ?? null,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix(CAT_ARTICULOS);
    await this.getArticulos();
    return data as { id: string; codigo: string };
  }

  // ── AS20 — múltiples fotos por artículo (con portada) ───────────────────────
  async getImagenesArticulo(articuloId: string): Promise<{ id: string; url: string; portada: boolean; orden: number }[]> {
    const { data, error } = await this.supabase.client
      .from('articulo_imagenes')
      .select('id, url, portada, orden')
      .eq('articulo_id', articuloId)
      .order('orden');
    if (error) return [];
    return (data as { id: string; url: string; portada: boolean; orden: number }[]) ?? [];
  }

  async agregarImagenArticulo(articuloId: string, blob: Blob, portada = false): Promise<void> {
    const url = await this.subirImagenArticulo(articuloId, blob);
    const { error } = await this.supabase.client.rpc('articulo_imagen_agregar', { p_articulo_id: articuloId, p_url: url, p_portada: portada });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix(CAT_ARTICULOS);
  }

  async setPortadaArticulo(imagenId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('articulo_set_portada', { p_imagen_id: imagenId });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix(CAT_ARTICULOS);
  }

  async eliminarImagenArticulo(imagenId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('articulo_imagen_eliminar', { p_imagen_id: imagenId });
    if (error) throw new Error(error.message);
    await this.catalog.invalidatePrefix(CAT_ARTICULOS);
  }

  /**
   * AS20 — actualiza campos/imagen de un artículo vía `articulo_actualizar_app`
   * (solo los valores provistos; el resto se conserva). Gate server-side. Refresca
   * la caché del catálogo para que la lista y los pickers reflejen el cambio.
   */
  async actualizarArticulo(
    id: string,
    campos: { nombre?: string; unidad?: string; categoriaId?: number | null; propiedad?: string; nota?: string | null; imagenUrl?: string | null },
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('articulo_actualizar_app', {
      p_id: id,
      p_nombre: campos.nombre ?? null,
      p_unidad: campos.unidad ?? null,
      p_categoria_id: campos.categoriaId ?? null,
      p_propiedad: campos.propiedad ?? null,
      p_nota: campos.nota === undefined ? null : campos.nota,
      p_imagen_url: campos.imagenUrl === undefined ? null : campos.imagenUrl,
    });
    if (error) throw new Error(error.message);
    // El catálogo cacheado quedó viejo: re-cárgalo (afecta catálogo + pickers).
    await this.catalog.invalidatePrefix(CAT_ARTICULOS);
    await this.getArticulos();
  }

  /**
   * AW6 — búsqueda FUZZY de artículos (RPC `buscar_articulos`, pg_trgm + unaccent):
   * tolera errores de tipeo, acentos y orden de palabras, y matchea por nombre,
   * código, categoría y subgrupo con ranking por relevancia. Devuelve ArticuloCat
   * mapeando por id contra la caché del catálogo (conserva los campos que usan los
   * pickers). Online; sin red o &lt;2 chars devuelve []. El caller debe hacer debounce.
   */
  async buscarArticulos(query: string, limit = 20): Promise<ArticuloCat[]> {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_articulos', {
      p_query: q,
      p_limit: limit,
    });
    if (error) return [];
    const rows =
      (data as Array<{ id: string; codigo: string; nombre: string; categoria_id: number; unidad: string; propiedad: string }>) ??
      [];
    const cache = await this.getArticulos().catch(() => [] as ArticuloCat[]);
    const byId = new Map(cache.map((a) => [a.id, a]));
    return rows.map(
      (r) =>
        byId.get(r.id) ??
        ({
          id: r.id,
          nombre: r.nombre,
          codigo: r.codigo,
          unidad: r.unidad,
          categoria_id: r.categoria_id,
          requiere_talla: false,
          nota: null,
          propiedad: r.propiedad,
          imagen_url: null,
        } as ArticuloCat),
    );
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
      .select(
        'id, nombre, descripcion, ubicacion, activo, es_principal, proyecto_id, latitud, longitud, direccion_geo, ubicacion_hereda_proyecto, ubicacion_metodo',
      )
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data as BodegaAdmin[]) ?? [];
  }

  /** AS12 — obras con ubicación (para vincular el almacén a una obra). */
  async getProyectosConUbicacion(): Promise<{ id: string; nombre: string; latitud: number | null; longitud: number | null }[]> {
    const { data, error } = await this.supabase.client.rpc('directorio_proyectos');
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? []).map((p) => ({
      id: p['id'] as string,
      nombre: p['nombre'] as string,
      latitud: (p['latitud'] as number) ?? null,
      longitud: (p['longitud'] as number) ?? null,
    }));
  }

  /** Create a warehouse. Server trigger homologates the name (R18). AS12 — ubicación opcional. */
  async crearBodega(input: {
    nombre: string;
    descripcion: string | null;
    ubicacion: string | null;
    location?: BodegaUbicacion;
  }): Promise<void> {
    const { error } = await this.supabase.client.from('bodegas').insert({
      nombre: input.nombre,
      descripcion: input.descripcion,
      ubicacion: input.ubicacion,
      ...(input.location ?? {}),
    });
    if (error) throw new Error(error.message);
    await this.refreshBodegas();
  }

  async actualizarBodega(
    id: string,
    input: { nombre: string; descripcion: string | null; ubicacion: string | null; location?: BodegaUbicacion },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('bodegas')
      .update({
        nombre: input.nombre,
        descripcion: input.descripcion,
        ubicacion: input.ubicacion,
        ...(input.location ?? {}),
      })
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

  /**
   * AU4 — bandeja de material NO catalogado: items libres reportados en conduces
   * pendientes de crear/vincular su artículo (regla AT11 — visibles para depurar el
   * catálogo). El RPC gatea por admin/inventario (devuelve [] a otros roles).
   */
  async materialNoCatalogadoPendientes(incluirResueltos = false): Promise<MaterialNoCatalogado[]> {
    const { data, error } = await this.supabase.client.rpc('material_no_catalogado_pendientes', {
      p_incluir_resueltos: incluirResueltos,
    });
    if (error) throw new Error(error.message);
    return (data as MaterialNoCatalogado[]) ?? [];
  }

  /**
   * AT11 — DECLINAR un material no catalogado (no hace falta crear el artículo, ya
   * existe, duplicado…). Lo saca de la bandeja → historial, con motivo, y notifica
   * a quien lo reportó. `sugeridoArticuloId` opcional (cuando el motivo es "ya existe").
   */
  async declinarItemLibre(itemLibreId: string, motivo: string, sugeridoArticuloId: string | null = null): Promise<void> {
    const { error } = await this.supabase.client.rpc('declinar_item_libre', {
      p_item_libre_id: itemLibreId,
      p_motivo: motivo,
      p_sugerido_articulo_id: sugeridoArticuloId,
    });
    if (error) throw new Error(error.message);
  }

  /**
   * AT12 — "Ajuste real": fija el stock de un artículo/almacén al valor REAL
   * informado, SIN generar un movimiento en el kardex ni un escalón en la gráfica
   * (rebase de la línea base; hermano de AP5). Solo admin — el RPC lo revalida
   * server-side. Online. Invalida la caché del inventario del almacén.
   */
  async ajusteRealStock(articuloId: string, bodegaId: string, cantidadReal: number): Promise<void> {
    const { error } = await this.supabase.client.rpc('ajuste_real_stock', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
      p_cantidad_real: cantidadReal,
    });
    if (error) throw new Error(error.message);
    void this.catalog.invalidate(`inv_almacen_${bodegaId}_all`).catch(() => {});
    void this.catalog.invalidate(`inv_almacen_${bodegaId}_nz`).catch(() => {});
  }

  async getExistencias(bodegaId: string): Promise<Existencia[]> {
    // Z18/Z16/Z17: bumped key a _v3 para traer categoria_id + propiedad + imagen_url.
    const key = `existencias_v3_${bodegaId}`;
    const data = await this.catalog.refresh<Existencia[]>(key, async () => {
      const { data, error } = await this.supabase.client
        .from('stock_por_bodega')
        .select('articulo_id, cantidad, articulo:articulos(nombre, codigo, unidad, categoria_id, propiedad, imagen_url)')
        .eq('bodega_id', bodegaId);
      if (error) throw new Error(error.message);
      type Row = {
        articulo_id: string;
        cantidad: number;
        articulo: {
          nombre: string; codigo: string; unidad: string; categoria_id: number | null;
          propiedad: string | null; imagen_url: string | null;
        } | null;
      };
      return ((data as unknown as Row[]) ?? []).map((r) => ({
        articulo_id: r.articulo_id,
        cantidad: Number(r.cantidad),
        nombre: r.articulo?.nombre ?? '—',
        codigo: r.articulo?.codigo ?? '',
        unidad: r.articulo?.unidad ?? '',
        categoria_id: r.articulo?.categoria_id ?? null, // Z18
        propiedad: r.articulo?.propiedad ?? null, // Z16
        imagen_url: r.articulo?.imagen_url ?? null, // Z17
      }));
    });
    return data ?? [];
  }

  /**
   * AP2 — inventario de un almacén: artículos con existencia + apertura efectiva.
   * Gateado server-side (`puede_ver_inventario_bodega`): admin, módulo inventario/
   * compras/proyectos/obra, o responsable de la obra del almacén. Un 42501 = sin
   * acceso (lo distinguimos del vacío). Cacheado por bodega para trabajar offline.
   */
  async inventarioAlmacen(
    bodegaId: string,
    incluirCero = true,
    busqueda: string | null = null,
  ): Promise<InventarioAlmacenItem[]> {
    // Solo cacheamos la vista completa (sin búsqueda) para el uso offline.
    const useCache = !busqueda;
    const fetcher = async (): Promise<InventarioAlmacenItem[]> => {
      const { data, error } = await this.supabase.client.rpc('inventario_almacen', {
        p_bodega_id: bodegaId,
        p_incluir_cero: incluirCero,
        p_busqueda: busqueda,
      });
      if (error) throw new Error(error.message);
      return ((data as InventarioAlmacenItem[]) ?? []).map((r) => ({
        ...r,
        cantidad: Number(r.cantidad ?? 0),
        apertura: Number(r.apertura ?? 0),
      }));
    };
    if (useCache) {
      const data = await this.catalog.refresh<InventarioAlmacenItem[]>(
        `inv_almacen_${bodegaId}_${incluirCero ? 'all' : 'nz'}`,
        fetcher,
      );
      return data ?? [];
    }
    return fetcher();
  }

  /**
   * AP3 — kardex de un artículo en un almacén (el sketch): movimientos + serie del
   * stock para el timeline. Se trae completo (una llamada); los filtros de tipo/
   * transportista/entrega/fecha se aplican en el cliente (recortan la lista, no la
   * serie). El saldo por fila ya viene acumulado del server.
   */
  async kardexArticulo(articuloId: string, bodegaId: string): Promise<Kardex> {
    const { data, error } = await this.supabase.client.rpc('kardex_articulo', {
      p_articulo_id: articuloId,
      p_bodega_id: bodegaId,
    });
    if (error) throw new Error(error.message);
    const k = (data as Kardex) ?? { apertura: 0, saldo_actual: 0, serie: [], movimientos: [] };
    return {
      apertura: Number(k.apertura ?? 0),
      saldo_actual: Number(k.saldo_actual ?? 0),
      serie: (k.serie ?? []).map((p) => ({ ts: p.ts, saldo: Number(p.saldo) })),
      movimientos: (k.movimientos ?? []).map((m) => ({
        ...m,
        cantidad: Number(m.cantidad ?? 0),
        delta: Number(m.delta ?? 0),
        saldo: Number(m.saldo ?? 0),
        firmas: m.firmas ?? [],
        fotos: m.fotos ?? [],
      })),
    };
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
      fotos: this.fotoOf(id, input.foto, input.firma),
      resumen: { tipo: 'salida', capturado_en, items: input.items.length },
    });
  }

  /**
   * AD6 — el CHOFER registra una compra/retiro en ferretería. Queda PENDIENTE
   * (chofer_registrar_compra_ferreteria) hasta que Almacén la confirma y sube el
   * stock. Offline-safe por outbox; idempotente por id. La app no tiene catálogo
   * de proveedores/órdenes de compra → el proveedor va como texto en observaciones
   * y la OC la enlaza Almacén al confirmar (gap documentado).
   */
  /** AF31/AF32 — ferreterías visibles para el chofer (origen de conduce = compra). */
  async getFerreterias(): Promise<Ferreteria[]> {
    const data = await this.catalog.refresh<Ferreteria[]>('ferreterias_visibles', async () => {
      const { data, error } = await this.supabase.client.rpc('ferreterias_visibles');
      if (error) throw new Error(error.message);
      return (data as Ferreteria[]) ?? [];
    });
    return data ?? [];
  }

  async enqueueCompraFerreteria(input: CompraFerreteriaCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    // Si viene un proveedor-ferretería del catálogo (AF31), va como id; el texto
    // libre se conserva en observaciones como red de seguridad / para OC legacy.
    const obs =
      [
        input.proveedor?.trim() ? `Ferretería/proveedor: ${input.proveedor.trim()}` : null,
        input.observaciones?.trim() || null,
      ]
        .filter(Boolean)
        .join(' — ') || null;
    await this.sync.enqueue({
      id,
      tipo_op: 'compra_ferreteria',
      capturado_en,
      payload: {
        id,
        bodega_id: input.bodegaId,
        proyecto_id: input.proyectoId,
        proveedor_id: input.proveedorId ?? null, // AF31 — id del catálogo
        referencia: input.referencia?.trim() || null,
        observaciones: obs,
        items: input.items,
        capturado_en,
      },
      fotos: [
        ...(input.foto
          ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `ferreteria/${id}/recibo.jpg`, slot: 'recibo', blob: input.foto }]
          : []),
        // AF12 — foto de la mercancía recibida (adicional al recibo).
        ...(input.fotoMercancia
          ? [{ id: crypto.randomUUID(), bucket: BUCKET, path: `ferreteria/${id}/mercancia.jpg`, slot: 'mercancia', blob: input.fotoMercancia }]
          : []),
      ],
      resumen: { tipo: 'compra_ferreteria', capturado_en, items: input.items.length },
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
      fotos: this.fotoOf(id, input.foto, input.firma),
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

  /** Dispatched conduces the user can receive (RLS scopes visibility).
   *  Z20: enriquecido con hora de creación, quién lo creó, observaciones y foto
   *  de despacho para la presentación clara del conduce. Cache bumped a _v2. */
  async conducesPorRecibir(): Promise<Conduce[]> {
    const data = await this.catalog.refresh<Conduce[]>('conduces_recibir_v2', async () => {
      const { data, error } = await this.supabase.client
        .from('salidas_inventario')
        .select(
          'id, fecha, created_at, estado, motivo, observaciones, foto_path, ' +
            'proyecto:proyectos(nombre), bodega:bodegas(nombre), ' +
            'creador:usuarios!salidas_inventario_creado_por_fkey(nombre), ' +
            'detalle_salidas(id, cantidad, articulo:articulos(nombre, unidad, entrega_en_mano))',
        )
        .eq('estado', 'despachado')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      type Row = {
        id: string; fecha: string; created_at: string | null; estado: string;
        motivo: string | null; observaciones: string | null; foto_path: string | null;
        proyecto: { nombre: string } | null; bodega: { nombre: string } | null;
        creador: { nombre: string } | null;
        detalle_salidas: { id: string; cantidad: number; articulo: { nombre: string; unidad: string; entrega_en_mano?: boolean } | null }[];
      };
      return ((data as unknown as Row[]) ?? []).map((r) => ({
        id: r.id,
        codigo: '#' + r.id.slice(0, 6).toUpperCase(), // Z20 — ref corta legible
        fecha: r.fecha,
        creado_en: r.created_at ?? null,
        creador: r.creador?.nombre ?? null,
        estado: r.estado,
        destino: r.proyecto?.nombre ?? null,
        bodega: r.bodega?.nombre ?? null,
        observaciones: r.observaciones ?? r.motivo ?? null,
        foto_path: r.foto_path ?? null,
        items: (r.detalle_salidas ?? []).map((d) => ({
          detalle_id: d.id,
          articulo: d.articulo?.nombre ?? '—',
          unidad: d.articulo?.unidad ?? '',
          cantidad: Number(d.cantidad),
          entregaEnMano: d.articulo?.entrega_en_mano ?? false, // AF16
        })),
      }));
    });
    return data ?? [];
  }

  /** Z20 — URL firmada de una foto del bucket `inventario` (o null). */
  async getFotoUrl(path: string | null | undefined): Promise<string | null> {
    if (!path) return null;
    const { data, error } = await this.supabase.client.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600);
    if (error) return null;
    return data?.signedUrl ?? null;
  }

  async enqueueRecepcion(input: RecepcionCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = [];
    // AF30 — varias fotos de evidencia de la descarga (slots recepcion_0..N).
    (input.fotos ?? []).forEach((blob, i) => {
      fotos.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `recepcion/${id}-${i}.jpg`, slot: `recepcion_${i}`, blob });
    });
    // AE — firma del receptor al bucket `conduces` (donde viven las firmas AC7).
    if (input.firmaReceptor) {
      fotos.push({
        id: crypto.randomUUID(),
        bucket: 'conduces',
        path: `${input.salidaId}/${id}-firma-receptor.png`,
        slot: 'firma_receptor',
        blob: input.firmaReceptor,
      });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_recepcion',
      capturado_en,
      payload: {
        salida_id: input.salidaId,
        items: input.items,
        notas: input.notas,
        receptor_nombre: input.receptorNombre ?? null,
        checklist: input.checklist ?? null, // AF13
      },
      fotos,
      resumen: { tipo: 'recepcion', salida_id: input.salidaId, capturado_en },
    });
    void this.conducesPorRecibir();
  }

  /**
   * AE — compras de ferretería del chofer pendientes de dar entrada (recibir el
   * material). Online best-effort, cacheado para verse offline tras la 1ª carga.
   */
  async misEntradasFerreteriaPendientes(): Promise<EntradaFerreteriaPendiente[]> {
    const data = await this.catalog.refresh<EntradaFerreteriaPendiente[]>(
      'entradas_ferreteria_pend',
      async () => {
        const { data, error } = await this.supabase.client.rpc('mis_entradas_ferreteria_pendientes');
        if (error) throw new Error(error.message);
        return (data as EntradaFerreteriaPendiente[]) ?? [];
      },
    );
    return data ?? [];
  }

  /**
   * AE — el chofer da ENTRADA a su compra de ferretería (materializa stock en el
   * almacén/obra destino). Offline-safe por outbox; el RPC es idempotente.
   */
  async enqueueConfirmarEntradaFerreteria(
    entradaId: string,
    items: { articulo_id: string; cantidad: number }[],
  ): Promise<void> {
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id: crypto.randomUUID(),
      tipo_op: 'entrada_ferreteria_confirmar',
      capturado_en,
      payload: { entrada_id: entradaId, items },
      resumen: { tipo: 'entrada_ferreteria', entrada_id: entradaId, capturado_en },
    });
    // AE7 — quitar la entrada confirmada de la caché SIN borrarla (borrarla dejaba
    // la lista vacía al recargar sin señal). El resto sigue visible offline.
    await this.catalog.optimisticUpdate<EntradaFerreteriaPendiente[]>(
      'entradas_ferreteria_pend',
      (prev) => (prev ?? []).filter((e) => e.id !== entradaId),
    );
    void this.misEntradasFerreteriaPendientes();
  }

  /**
   * AE — el chofer registra una DEVOLUCIÓN de material (obra → almacén): el stock
   * se mueve directo y se capturan las 2 firmas (emisor=chofer + receptor). Si el
   * receptor no firmó ahora, su firma queda pendiente y se le enruta. Offline-safe.
   */
  async enqueueDevolucionChofer(input: DevolucionChoferCaptura): Promise<void> {
    const id = crypto.randomUUID(); // = id de la salida (idempotencia)
    const capturado_en = new Date().toISOString();
    const fotos = [
      { id: crypto.randomUUID(), bucket: 'conduces', path: `devoluciones/${id}/firma-emisor.png`, slot: 'firma_emisor', blob: input.firmaEmisor },
    ];
    if (input.firmaReceptor) {
      fotos.push({ id: crypto.randomUUID(), bucket: 'conduces', path: `devoluciones/${id}/firma-receptor.png`, slot: 'firma_receptor', blob: input.firmaReceptor });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'devolucion_chofer',
      capturado_en,
      payload: {
        id,
        fecha: capturado_en.slice(0, 10),
        bodega_destino_id: input.bodegaDestinoId,
        origen_proyecto_id: input.origenProyectoId,
        referencia: input.referencia,
        observaciones: input.observaciones,
        items: input.items,
        emisor_nombre: input.emisorNombre,
        receptor_nombre: input.receptorNombre,
        receptor_usuario_id: input.receptorUsuarioId,
        confirmar_almacen: input.confirmarPorAlmacen ?? false, // AE8
      },
      fotos,
      resumen: { tipo: 'devolucion', bodega_destino_id: input.bodegaDestinoId, capturado_en },
    });
    await this.catalog.invalidatePrefix('existencias_');
  }

  /** AE — bandeja "Por firmar": entregas con mi firma de receptor pendiente. */
  async misFirmasPendientes(): Promise<FirmaPendiente[]> {
    const data = await this.catalog.refresh<FirmaPendiente[]>('firmas_pendientes', async () => {
      const { data, error } = await this.supabase.client.rpc('mis_firmas_pendientes');
      if (error) throw new Error(error.message);
      return (data as FirmaPendiente[]) ?? [];
    });
    return data ?? [];
  }

  /** AE — firmar (tarde) como receptor una entrega que estaba pendiente. Offline-safe. */
  async enqueueFirmarReceptor(salidaId: string, nombre: string, firma: Blob): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'conduce_firmar_receptor',
      capturado_en,
      payload: { salida_id: salidaId, nombre },
      fotos: [{ id: crypto.randomUUID(), bucket: 'conduces', path: `${salidaId}/firma-receptor-tardia.png`, slot: 'firma', blob: firma }],
      resumen: { tipo: 'firmar_receptor', salida_id: salidaId, capturado_en },
    });
    // AE7 — quitar la firma resuelta de la caché SIN borrarla (borrarla dejaba la
    // bandeja "Por firmar" vacía al recargar sin señal). El resto sigue visible.
    await this.catalog.optimisticUpdate<FirmaPendiente[]>(
      'firmas_pendientes',
      (prev) => (prev ?? []).filter((f) => f.salida_id !== salidaId),
    );
  }

  /** AE — stock del almacén de una obra ({articulo_id: cantidad}) para el preview
   *  de la devolución (avisar si se devuelve más de lo que hay). */
  async existenciasDeObra(proyectoId: string): Promise<Record<string, number>> {
    const { data, error } = await this.supabase.client.rpc('existencias_de_obra', { p_proyecto_id: proyectoId });
    if (error) throw new Error(error.message);
    return (data as Record<string, number>) ?? {};
  }

  /** AE — buscar usuarios para elegir al receptor (ingeniero/encargado). */
  async buscarUsuarios(term: string): Promise<UsuarioBusqueda[]> {
    if (term.trim().length < 2) return [];
    const { data, error } = await this.supabase.client.rpc('buscar_usuarios', { p_term: term.trim() });
    if (error) throw new Error(error.message);
    return (data as UsuarioBusqueda[]) ?? [];
  }

  /**
   * Y10 — historial de conteos/ajustes de inventario (parity con la web). La RLS
   * `conteos_select` scopea a admin/módulo inventario. Online-first (el histórico
   * no necesita offline completo).
   */
  async getConteos(): Promise<ConteoHistorial[]> {
    const { data, error } = await this.supabase.client
      .from('conteos_inventario')
      .select(
        'id, motivo, tipo, observaciones, created_at, bodega:bodegas(nombre), creado:usuarios(nombre), ' +
          'items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre, codigo))',
      )
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return [];
    return (data as unknown as ConteoHistorial[]) ?? [];
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

  private fotoOf(id: string, foto: Blob | null, firma?: Blob | null) {
    const out: { id: string; bucket: string; path: string; slot: string; blob: Blob }[] = [];
    if (foto) out.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${id}/evidencia.jpg`, slot: 'evidencia', blob: foto });
    // AF10 — firma final (entrega/recibe) junto a la evidencia.
    if (firma) out.push({ id: crypto.randomUUID(), bucket: BUCKET, path: `${id}/firma.png`, slot: 'firma', blob: firma });
    return out;
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
        p_firma_path: photoPaths['firma'] ?? null, // AF10
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
        p_firma_path: photoPaths['firma'] ?? null, // AF10
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
        // AE7 — UUID de cliente → overload idempotente (evita doble-conteo de
        // stock si el outbox reintenta tras una respuesta perdida).
        p_id: payload['id'],
      });
      // Rechazo por stock insuficiente / obra sin almacén → P0001 permanente,
      // legible en "Pendientes de envío" (FASE 1).
      if (error) throwSyncError(error);
      // El stock cambió en ambas bodegas: invalida las existencias cacheadas.
      await this.catalog.invalidatePrefix('existencias_');
    });

    this.sync.register('conduce_recepcion', async (payload, photoPaths) => {
      const salidaId = payload['salida_id'] as string;
      // AF30 — todas las fotos de evidencia de la descarga (slots recepcion_0..N).
      const recepcionPaths = Object.keys(photoPaths)
        .filter((k) => k.startsWith('recepcion'))
        .sort()
        .map((k) => photoPaths[k])
        .filter((p): p is string => !!p);
      const { error } = await this.supabase.client.rpc('recibir_conduce_app', {
        p_salida_id: salidaId,
        p_items: payload['items'],
        p_notas: payload['notas'] ?? null,
        p_foto_path: recepcionPaths[0] ?? null, // la primera queda como foto principal
      });
      if (error) throwSyncError(error);
      // AE — firma del RECEPTOR (AC7). Idempotente por (salida_id, rol); best-effort:
      // si falla no revierte la recepción (ya registrada).
      const firmaReceptor = photoPaths['firma_receptor'];
      if (firmaReceptor) {
        const { data: userData } = await this.supabase.client.auth.getUser();
        // Verificado (antifraude): si falla, el outbox reintenta (firmar_conduce es
        // idempotente por (salida_id, rol)).
        const { error: eF } = await this.supabase.client.rpc('firmar_conduce', {
          p_salida_id: salidaId,
          p_rol: 'receptor',
          p_nombre: payload['receptor_nombre'] ?? 'Receptor',
          p_firma_path: firmaReceptor,
          p_usuario_id: userData.user?.id ?? null,
        });
        if (eF) throwSyncError(eF);
      }
      // AF13 — registra la evidencia completa (todas las fotos + checklist + notas)
      // en el backend de confirmaciones (PROMPT-1), visible en el detalle web.
      // Best-effort: la recepción ya quedó registrada arriba.
      try {
        await this.supabase.client.rpc('registrar_confirmacion_recepcion', {
          p_entidad_tipo: 'conduce',
          p_entidad_id: salidaId,
          p_modo: 'presencial',
          p_fotos: recepcionPaths,
          p_notas: payload['notas'] ?? null,
          p_checklist: payload['checklist'] ?? null,
        });
      } catch {
        /* la confirmación de evidencia es complementaria; no revierte la recepción */
      }
    });

    // AE — el chofer da entrada a su compra de ferretería (materializa stock).
    this.sync.register('entrada_ferreteria_confirmar', async (payload) => {
      const { error } = await this.supabase.client.rpc('confirmar_entrada_chofer', {
        p_entrada_id: payload['entrada_id'],
        p_items: payload['items'] ?? null,
      });
      if (error) throwSyncError(error);
    });

    // AE — devolución de material del chofer (obra→almacén) con doble firma.
    this.sync.register('devolucion_chofer', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('chofer_registrar_devolucion', {
        p_id: payload['id'],
        p_fecha: payload['fecha'],
        p_bodega_destino_id: payload['bodega_destino_id'],
        p_origen_proyecto_id: payload['origen_proyecto_id'],
        p_referencia: payload['referencia'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_items: payload['items'],
        p_emisor_nombre: payload['emisor_nombre'] ?? 'Chofer',
        p_emisor_firma_path: photoPaths['firma_emisor'],
        p_receptor_nombre: payload['receptor_nombre'] ?? null,
        p_receptor_usuario_id: payload['receptor_usuario_id'] ?? null,
        p_receptor_firma_path: photoPaths['firma_receptor'] ?? null,
        // AE8 — cuando el chofer no recibe él mismo, la firma queda pendiente de
        // que la confirme Almacén (overload de 13 args).
        p_confirmar_almacen: payload['confirmar_almacen'] ?? false,
      });
      if (error) throwSyncError(error);
    });

    // AE — firmar (tarde) como receptor una entrega que estaba pendiente.
    this.sync.register('conduce_firmar_receptor', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('firmar_conduce', {
        p_salida_id: payload['salida_id'],
        p_rol: 'receptor',
        p_nombre: payload['nombre'] ?? 'Receptor',
        p_firma_path: photoPaths['firma'],
      });
      if (error) throwSyncError(error);
    });

    this.sync.register('compra_ferreteria', async (payload, photoPaths) => {
      const { error } = await this.supabase.client.rpc('chofer_registrar_compra_ferreteria', {
        p_id: payload['id'],
        p_fecha: (payload['capturado_en'] as string).slice(0, 10),
        p_bodega_id: payload['bodega_id'],
        p_proveedor_id: payload['proveedor_id'] ?? null, // AF31 — ferretería del catálogo
        p_proyecto_id: payload['proyecto_id'] ?? null,
        p_orden_compra_id: null, // Almacén enlaza la OC al confirmar
        p_referencia: payload['referencia'] ?? null,
        p_observaciones: payload['observaciones'] ?? null,
        p_foto_path: photoPaths['recibo'] ?? null,
        p_items: payload['items'] ?? [],
        p_foto_mercancia_path: photoPaths['mercancia'] ?? null, // AF12
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
      // Y10 — un conteo ajusta el stock: invalidar las existencias cacheadas para
      // que existencias/conteo/salida reflejen las cantidades nuevas al recargar.
      await this.catalog.invalidatePrefix('existencias_');
    });
  }
}
