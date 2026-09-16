import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Proyecto } from '../models/bitacora.model';
import {
  AceroDiametro,
  CartillaCaptura,
  CartillaDetalle,
  CartillaEstado,
  CartillaFigura,
  CartillaListado,
} from '../../shared/models/cartilla.model';

const BUCKET = 'sgc-cartillas';
const CAT_MIS = 'mis_cartillas';
const CAT_DIAM = 'acero_diametros';
const CAT_FIG = 'cartilla_figuras';

/**
 * BO10 — Cartillas de acero. Captura offline-first (outbox) de los atados/piezas
 * de acero. Espeja el molde de RetirosService (BG4): fotos → bucket, handler →
 * RPC idempotente. Los catálogos (diámetros/figuras) son de lectura abierta y se
 * cachean (read-through) para funcionar offline. Ramón/oficina revisan en la web.
 */
@Injectable({ providedIn: 'root' })
export class CartillaService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  /** Obras del ingeniero (scoped, mismo selector que la requisición/retiro). */
  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>('proyectos', async () => {
      const { data, error } = await this.supabase.client.rpc('proyectos_pickables');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** Catálogo de diámetros de acero (kg/m para el peso en vivo). Read-through. */
  async diametros(): Promise<AceroDiametro[]> {
    const data = await this.catalog.refresh<AceroDiametro[]>(CAT_DIAM, async () => {
      const { data, error } = await this.supabase.client
        .from('acero_diametros')
        .select('codigo, mm, kg_por_m, activo')
        .eq('activo', true)
        .order('mm');
      if (error) throw new Error(error.message);
      return (data as unknown as AceroDiametro[]) ?? [];
    });
    return data ?? [];
  }

  /** Catálogo de figuras de acero. Read-through (el SVG se dibuja por código). */
  async figuras(): Promise<CartillaFigura[]> {
    const data = await this.catalog.refresh<CartillaFigura[]>(CAT_FIG, async () => {
      const { data, error } = await this.supabase.client
        .from('cartilla_figuras')
        .select('codigo, nombre, svg, activo')
        .eq('activo', true)
        .order('codigo');
      if (error) throw new Error(error.message);
      return (data as unknown as CartillaFigura[]) ?? [];
    });
    return data ?? [];
  }

  /** "Mis cartillas" (o todas las visibles por rol). Cache-then-network. */
  async misCartillas(): Promise<CartillaListado[]> {
    const data = await this.catalog.refresh<CartillaListado[]>(CAT_MIS, async () => {
      const { data, error } = await this.supabase.client.rpc('cartillas_listado', {});
      if (error) throw new Error(error.message);
      return (data as CartillaListado[]) ?? [];
    });
    return data ?? [];
  }

  /** Detalle de una cartilla (cache-then-network para verla offline). */
  async detalle(id: string): Promise<CartillaDetalle | null> {
    const data = await this.catalog.refresh<CartillaDetalle | null>(`cartilla_detalle:${id}`, async () => {
      const { data, error } = await this.supabase.client.rpc('cartilla_detalle', { p_id: id });
      if (error) throw new Error(error.message);
      return (data as CartillaDetalle) ?? null;
    });
    return data ?? null;
  }

  /** Resumen de acero por diámetro (kg) para el reporte por obra/fecha. Online. */
  async resumenAcero(proyectoId?: string, desde?: string, hasta?: string): Promise<{ diametro_codigo: string; kg: number }[]> {
    const { data, error } = await this.supabase.client.rpc('cartillas_resumen_acero', {
      p_proyecto_id: proyectoId ?? null,
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data as { diametro_codigo: string; kg: number }[]) ?? [];
  }

  async invalidarCache(id?: string): Promise<void> {
    await this.catalog.invalidate(CAT_MIS);
    if (id) await this.catalog.invalidate(`cartilla_detalle:${id}`);
  }

  /** URL firmada de una foto/plano de la cartilla (bucket privado). */
  async fotoUrl(path: string): Promise<string | null> {
    try {
      const { data, error } = await this.supabase.client.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) return null;
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  /** Cambia el estado (revisada/observada/ejecutada). Online. */
  async cambiarEstado(id: string, estado: CartillaEstado, nota?: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cartilla_cambiar_estado', {
      p_id: id,
      p_estado: estado,
      p_nota: nota ?? null,
    });
    if (error) throw new Error(error.message);
    await this.invalidarCache(id);
  }

  /**
   * Encola la cartilla (offline-first). Fotos + plano suben al bucket sgc-cartillas;
   * el handler llama crear_cartilla (idempotente por p_id). Valida diámetro/figura
   * contra el catálogo server-side (22023 con detail=campo=… → categoría 'dato').
   */
  async enqueueCartilla(input: CartillaCaptura): Promise<string> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    const fotos = input.fotos.map((blob, i) => ({
      id: `${id}:foto_${i}`,
      bucket: BUCKET,
      path: `${id}/foto/${i}.jpg`,
      slot: `foto_${i}`,
      blob,
    }));
    if (input.plano) {
      fotos.push({ id: `${id}:plano`, bucket: BUCKET, path: `${id}/plano.jpg`, slot: 'plano', blob: input.plano });
    }
    await this.sync.enqueue({
      id,
      tipo_op: 'cartilla',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        fecha: input.fecha,
        atados: input.atados,
        notas: input.notas,
        foto_slots: input.fotos.map((_, i) => `foto_${i}`),
      },
      fotos,
      resumen: {
        tipo: 'cartilla',
        capturado_en,
        atados: input.atados.length,
        piezas: input.atados.reduce((s, a) => s + a.piezas.length, 0),
      },
    });
    void this.misCartillas();
    return id;
  }

  private registerHandler(): void {
    this.sync.register('cartilla', async (payload, photoPaths) => {
      const slots = (payload['foto_slots'] as string[] | undefined) ?? Object.keys(photoPaths).filter((s) => s !== 'plano');
      const p_fotos = slots
        .map((slot) => photoPaths[slot])
        .filter((path): path is string => !!path)
        .map((path) => ({ path }));
      const { error } = await this.supabase.client.rpc('crear_cartilla', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_fecha: payload['fecha'],
        p_atados: payload['atados'],
        p_fotos,
        p_plano_path: photoPaths['plano'] ?? null,
        p_notas: payload['notas'] ?? null,
      });
      if (error) throwSyncError(error);
    });
  }
}
