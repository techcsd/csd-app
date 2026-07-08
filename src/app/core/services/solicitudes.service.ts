import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { PermanentSyncError, SyncService } from '../sync/sync.service';
import { Proyecto } from '../models/bitacora.model';
import { Solicitud, Urgencia } from '../models/inventario.model';

const CAT_PROYECTOS = 'proyectos';
const CAT_SOLICITUDES = 'mis_solicitudes';

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
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select('id, nombre')
        .order('nombre');
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
        .select('id, estado, urgencia, notas, created_at, proyecto:proyectos(nombre), items:solicitud_material_items(descripcion, cantidad, unidad)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return (data as unknown as Solicitud[]) ?? [];
    });
    return data ?? [];
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
      if (error) throw new PermanentSyncError(error.message);
    });
  }
}
