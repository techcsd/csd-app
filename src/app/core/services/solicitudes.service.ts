import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { throwSyncError, SyncService } from '../sync/sync.service';
import { Proyecto } from '../models/bitacora.model';
import { MiOrdenCompra, RequisicionAvanceItem, RequisicionBandeja, RequisicionDetalle, RequisicionEdicion, RequisicionEditar, Solicitud, Urgencia } from '../models/inventario.model';

/** AS7 — filtros de la bandeja de requisiciones. */
export interface RequisicionFiltros {
  estado?: string | null;
  proyectoId?: string | null;
  urgencia?: string | null;
  busqueda?: string | null;
  limite?: number;
}

const CAT_PROYECTOS = 'proyectos';
const CAT_SOLICITUDES = 'mis_solicitudes';
const CAT_MIS_ORDENES = 'mis_ordenes_compra';

export interface SolicitudCaptura {
  proyectoId: string;
  urgencia: Urgencia;
  notas: string | null;
  items: { articulo_id: string | null; descripcion: string; cantidad: number; unidad: string }[];
}

/**
 * Material requests from the field. Enqueued offline; committed via
 * sgc.crear_solicitud_app so the request lands in SGC's Solicitudes module
 * (approver sees it) exactly as a web-created one.
 */
@Injectable({ providedIn: 'root' })
export class SolicitudesService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);
  private sync = inject(SyncService);

  constructor() {
    this.registerHandler();
  }

  async getProyectos(): Promise<Proyecto[]> {
    const data = await this.catalog.refresh<Proyecto[]>(CAT_PROYECTOS, async () => {
      // QA-17: el SELECT directo sobre `proyectos` devolvía [] a usuarios de compras
      // (la RLS no admite ese módulo). Vía RPC security-definer que sí los incluye.
      const { data, error } = await this.supabase.client.rpc('proyectos_pickables');
      if (error) throw new Error(error.message);
      return (data as Proyecto[]) ?? [];
    });
    return data ?? [];
  }

  /** RLS scopes to the requester's own rows for non-inventario users. */
  async misSolicitudes(): Promise<Solicitud[]> {
    const data = await this.catalog.refresh<Solicitud[]>(CAT_SOLICITUDES, async () => {
      const { data, error } = await this.supabase.client
        .from('solicitudes_material')
        .select('id, estado, urgencia, notas, created_at, folio, proyecto:proyectos(nombre), items:solicitud_material_items(descripcion, cantidad, unidad)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data as unknown as Solicitud[]) ?? [];
    });
    return data ?? [];
  }

  /**
   * AY3 (follow-up) — estado de las órdenes de compra nacidas de MIS requisiciones
   * (RPC scoped a solicitante_id). Cache-then-network (offline-safe): si no hay señal
   * usa lo cacheado. Se usa en "Mis requisiciones" para mostrar el avance de la orden.
   */
  async misOrdenesDeCompra(): Promise<MiOrdenCompra[]> {
    const data = await this.catalog.refresh<MiOrdenCompra[]>(CAT_MIS_ORDENES, async () => {
      const { data, error } = await this.supabase.client.rpc('mis_ordenes_de_compra');
      if (error) throw new Error(error.message);
      return (data as MiOrdenCompra[]) ?? [];
    });
    return data ?? [];
  }

  // ── AS7 — Bandeja de requisiciones (todas, por rol) ─────────────────────────
  /** ¿El usuario puede ver TODAS las requisiciones? (gate server-side). */
  async puedeVerTodas(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.rpc('puede_ver_todas_requisiciones');
      if (error) return false;
      return !!data;
    } catch {
      return false;
    }
  }

  /** Listado filtrable de todas las requisiciones visibles. Online (best-effort). */
  async bandeja(filtros: RequisicionFiltros = {}): Promise<RequisicionBandeja[]> {
    const { data, error } = await this.supabase.client.rpc('requisiciones_bandeja', {
      p_estado: filtros.estado ?? null,
      p_proyecto_id: filtros.proyectoId ?? null,
      p_urgencia: filtros.urgencia ?? null,
      p_busqueda: filtros.busqueda ?? null,
      p_limite: filtros.limite ?? 100,
    });
    if (error) throw new Error(error.message);
    return (data as RequisicionBandeja[]) ?? [];
  }

  /** BC1 — Detalle completo de una requisición (por rol o por su solicitante).
   *  Cache-then-network: offline devuelve la última versión sincronizada (marcada
   *  en la UI vía `detalleFetchedAt`). */
  async detalle(id: string): Promise<RequisicionDetalle | null> {
    const data = await this.catalog.refresh<RequisicionDetalle | null>(`req_detalle:${id}`, async () => {
      const { data, error } = await this.supabase.client.rpc('requisicion_detalle', { p_id: id });
      if (error) throw new Error(error.message);
      return (data as RequisicionDetalle) ?? null;
    });
    return data ?? null;
  }

  /** BC1 — ¿cuándo se cargó por última vez el detalle cacheado? (null = nunca). */
  async detalleFetchedAt(id: string): Promise<number | null> {
    return this.catalog.fetchedAt(`req_detalle:${id}`);
  }

  /** BA6 — avance de despachos renglón por renglón (solicitado/despachado/pendiente). */
  async avance(id: string): Promise<RequisicionAvanceItem[]> {
    const data = await this.catalog.refresh<RequisicionAvanceItem[]>(`req_avance:${id}`, async () => {
      const { data, error } = await this.supabase.client.rpc('requisicion_avance', { p_solicitud_id: id });
      if (error) throw new Error(error.message);
      return (data as RequisicionAvanceItem[]) ?? [];
    });
    return data ?? [];
  }

  /** BB10 — historial de ediciones del autor sobre su requisición. */
  async ediciones(id: string): Promise<RequisicionEdicion[]> {
    const data = await this.catalog.refresh<RequisicionEdicion[]>(`req_ediciones:${id}`, async () => {
      const { data, error } = await this.supabase.client.rpc('requisicion_ediciones', { p_solicitud_id: id });
      if (error) throw new Error(error.message);
      return (data as RequisicionEdicion[]) ?? [];
    });
    return data ?? [];
  }

  /** BA6 — ¿el usuario puede gestionar (cancelar/cerrar) esta requisición? */
  async puedeGestionar(id: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.rpc('puede_gestionar_requisicion', { p_solicitud_id: id });
      if (error) return false;
      return !!data;
    } catch {
      return false;
    }
  }

  /** BB10/BF6 — edita una requisición PENDIENTE o RECHAZADA (solo el autor/admin).
   *  Online (no outbox: es una corrección puntual que necesita eco inmediato del
   *  servidor). BF6: al editar una RECHAZADA, el server la reenvía (vuelve a
   *  'pendiente' a la misma bandeja, v2) — se devuelve `reenviada` para el aviso. */
  async editar(input: RequisicionEditar): Promise<{ reenviada: boolean; version: number | null }> {
    const { data, error } = await this.supabase.client.rpc('editar_requisicion', {
      p_solicitud_id: input.id,
      p_urgencia: input.urgencia ?? null,
      p_notas: input.notas ?? null,
      p_items: input.items ?? null,
      p_proyecto_id: input.proyectoId ?? null,
    });
    if (error) throw new Error(error.message);
    await this.invalidarCache(input.id);
    const res = (data ?? {}) as { reenviada?: boolean; version?: number };
    return { reenviada: !!res.reenviada, version: res.version ?? null };
  }

  /** BA6 — cancela una requisición con motivo obligatorio (rol con permiso). Online. */
  async cancelar(id: string, motivo: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('requisicion_cancelar', {
      p_solicitud_id: id,
      p_motivo: motivo,
    });
    if (error) throw new Error(error.message);
    await this.invalidarCache(id);
  }

  /** BC1 — fuerza re-consulta del detalle/avance/ediciones (pull-to-refresh). */
  async invalidarCache(id: string): Promise<void> {
    await Promise.all([
      this.catalog.invalidate(`req_detalle:${id}`),
      this.catalog.invalidate(`req_avance:${id}`),
      this.catalog.invalidate(`req_ediciones:${id}`),
      this.catalog.invalidate(CAT_SOLICITUDES),
    ]);
  }

  /**
   * AS7 — aprueba una requisición: despacha lo disponible del almacén elegido y el
   * faltante genera una solicitud de compra (lógica server-side de `aprobar_requisicion`,
   * la misma de la web). Online (mueve stock; no va por outbox a propósito).
   */
  async aprobarRequisicion(input: {
    id: string;
    bodegaId: string;
    fecha: string;
    responsable?: string | null;
    observaciones?: string | null;
    items: { articulo_id: string | null; descripcion: string; cantidad: number; unidad: string | null; talla: string | null }[];
  }): Promise<void> {
    const { error } = await this.supabase.client.rpc('aprobar_requisicion', {
      p_solicitud_id: input.id,
      p_bodega_id: input.bodegaId,
      p_fecha: input.fecha,
      p_responsable: input.responsable ?? null,
      p_observaciones: input.observaciones ?? null,
      p_items: input.items,
    });
    if (error) throw new Error(error.message);
  }

  /** AS7 — rechaza una requisición con una nota (RPC `rechazar_solicitud_material`). Online. */
  async rechazarRequisicion(id: string, nota: string | null): Promise<void> {
    const { error } = await this.supabase.client.rpc('rechazar_solicitud_material', {
      p_solicitud_id: id,
      p_notas: nota,
    });
    if (error) throw new Error(error.message);
  }

  /** Conteo de requisiciones pendientes para el badge de la bandeja. */
  async bandejaCount(): Promise<number> {
    try {
      const { data, error } = await this.supabase.client.rpc('requisiciones_bandeja_count');
      if (error) return 0;
      return (data as number) ?? 0;
    } catch {
      return 0;
    }
  }

  async enqueueSolicitud(input: SolicitudCaptura): Promise<void> {
    const id = crypto.randomUUID();
    const capturado_en = new Date().toISOString();
    await this.sync.enqueue({
      id,
      tipo_op: 'solicitud',
      capturado_en,
      payload: {
        id,
        proyecto_id: input.proyectoId,
        urgencia: input.urgencia,
        notas: input.notas,
        items: input.items,
      },
      resumen: { tipo: 'solicitud', capturado_en, items: input.items.length },
    });
    void this.misSolicitudes();
  }

  private registerHandler(): void {
    this.sync.register('solicitud', async (payload) => {
      const { error } = await this.supabase.client.rpc('crear_solicitud_app', {
        p_id: payload['id'],
        p_proyecto_id: payload['proyecto_id'],
        p_urgencia: payload['urgencia'],
        p_notas: payload['notas'] ?? null,
        p_items: payload['items'],
      });
      if (error) throwSyncError(error);

      // B3/U25 — inteligencia de "Otro/s": los materiales del "08 Otros" (sin
      // articulo_id, texto libre) se registran estructurados en otros_valores
      // (contexto 'material'). Best-effort: no falla el sync de la solicitud.
      const items = (payload['items'] as Array<{ articulo_id: string | null; descripcion?: string }>) ?? [];
      for (const it of items) {
        const desc = it.descripcion?.trim();
        if (!it.articulo_id && desc) {
          try {
            await this.supabase.client.rpc('registrar_otro_valor', {
              p_contexto: 'material',
              p_valor: desc,
              p_referencia_id: payload['id'],
            });
          } catch {
            /* intelligence-only: never block the solicitud sync */
          }
        }
      }

      // Same email notification the web fires (notificar-solicitud edge fn).
      // Fire-and-forget: a notification failure must not fail the sync — the
      // solicitud already lands in SGC and shows on the approver's badge.
      this.supabase.client.functions
        .invoke('notificar-solicitud', {
          body: { tipo: 'material', solicitudId: payload['id'], evento: 'creada' },
        })
        .catch(() => {});
    });
  }
}
