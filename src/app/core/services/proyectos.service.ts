import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { ProyectoApp } from '../models/proyecto.model';

/** AH15 — una compra ligada a un proyecto (OC o compra de ferretería). */
export interface CompraProyecto {
  tipo: 'orden_compra' | 'ferreteria';
  id: string;
  fecha: string | null;
  proveedor: string | null;
  total: number | null;
  estado: string | null;
  referencia: string | null;
}

const CAT_PROYECTOS = 'proyectos_full'; // distinto del 'proyectos' mínimo (pedir/pickers)
const CAT_PICKABLES = 'proyectos_pickables'; // QA-17 — obras mínimas para pickers

/** QA-17 — obra elegible para un picker (id/nombre). */
export interface ProyectoPickable {
  id: string;
  nombre: string;
  responsable_nombre: string | null;
}
const SELECT =
  'id, codigo, nombre, cliente, tipo, estado, fecha_inicio, fecha_fin_estimada, fecha_fin_real, ' +
  'ubicacion, localidad, descripcion, responsable:usuarios(nombre), ' +
  'fases:fases_proyecto(id, proyecto_id, nombre, descripcion, estado, fecha_inicio, fecha_fin, progreso, orden)';

/**
 * Y14 — lectura del módulo Proyectos para la app (listado + detalle). La RLS de
 * `proyectos` scopea las filas (admin/módulo proyectos → todos; responsable/
 * miembro → los suyos); el tile de Proyectos está gateado por `hasModulo
 * ('proyectos')`, así que quien lo ve recibe todos. Online-first con cache
 * (patrón CatalogService) para que la navegación no rompa sin señal.
 */
@Injectable({ providedIn: 'root' })
export class ProyectosService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  /** Listado de proyectos visibles (cache-then-network). */
  async getProyectos(): Promise<ProyectoApp[]> {
    const data = await this.catalog.refresh<ProyectoApp[]>(CAT_PROYECTOS, async () => {
      const { data, error } = await this.supabase.client
        .from('proyectos')
        .select(SELECT)
        .order('created_at', { ascending: false })
        .order('orden', { referencedTable: 'fases_proyecto', ascending: true });
      if (error) throw new Error(error.message);
      return (data as unknown as ProyectoApp[]) ?? [];
    });
    return (data ?? []).map(normalizar);
  }

  /**
   * QA-17 — obras elegibles para pickers (p. ej. Compras de obra). Usa el RPC
   * security-definer `proyectos_pickables`, que incluye a roles que la RLS directa
   * de `proyectos` no admite (compras/bitácora/obra) y ya filtra `es_prueba`.
   */
  async getProyectosPickables(): Promise<ProyectoPickable[]> {
    const data = await this.catalog.refresh<ProyectoPickable[]>(CAT_PICKABLES, async () => {
      const { data, error } = await this.supabase.client.rpc('proyectos_pickables');
      if (error) throw new Error(error.message);
      return (data as ProyectoPickable[]) ?? [];
    });
    return data ?? [];
  }

  /** Detalle de un proyecto (sirve del cache del listado; refresca best-effort). */
  async getProyecto(id: string): Promise<ProyectoApp | null> {
    const cached = (await this.catalog.read<ProyectoApp[]>(CAT_PROYECTOS)) ?? [];
    const local = cached.find((p) => p.id === id);
    // Refresca puntualmente el detalle (con fases) sin invalidar el listado.
    const { data, error } = await this.supabase.client
      .from('proyectos')
      .select(SELECT)
      .eq('id', id)
      .order('orden', { referencedTable: 'fases_proyecto', ascending: true })
      .maybeSingle();
    if (error || !data) return local ? normalizar(local) : null;
    return normalizar(data as unknown as ProyectoApp);
  }

  /**
   * AH15 — compras (órdenes de compra + ferretería) de un proyecto en un rango de
   * fechas. El RPC `compras_de_proyecto` resuelve proveedor/total y respeta
   * permisos (admin/proyectos/compras/obra/responsable/miembro) + es_prueba.
   */
  async comprasDeProyecto(proyectoId: string, desde: string | null, hasta: string | null): Promise<CompraProyecto[]> {
    const { data, error } = await this.supabase.client.rpc('compras_de_proyecto', {
      p_proyecto_id: proyectoId,
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(error.message);
    return ((data as CompraProyecto[]) ?? []).map((c) => ({ ...c, total: c.total == null ? null : Number(c.total) }));
  }
}

/** Normaliza numéricos de PostgREST (progreso llega como string) + fases[]. */
function normalizar(p: ProyectoApp): ProyectoApp {
  return {
    ...p,
    fases: (p.fases ?? [])
      .map((f) => ({ ...f, progreso: Number(f.progreso) || 0 }))
      .sort((a, b) => a.orden - b.orden),
  };
}
