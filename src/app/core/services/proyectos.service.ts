import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { ProyectoApp, ProyectoInput, ResponsableProyecto } from '../models/proyecto.model';

/** AM7 — resultado de resolver un link/coordenadas (edge resolve-maps-link). */
export interface UbicacionResuelta {
  lat: number;
  lng: number;
  source: 'coords' | 'maps_link';
  resolved_url: string | null;
}

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

/** AS14 — categoría de gasto directo (catálogo). */
export interface GastoCategoria {
  clave: string;
  label: string;
}

/** AS14 — gasto directo del proyecto (fuera de requisición). */
export interface GastoDirecto {
  id: string;
  fecha: string;
  categoria_clave: string;
  categoria: string;
  concepto: string;
  monto: number;
  recibo_path: string | null;
  registrado_por: string | null;
  registrado_por_nombre: string | null;
  created_at: string;
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
  'ubicacion, localidad, descripcion, presupuesto, ' +
  'latitud, longitud, direccion_geo, ubicacion_metodo, ' + // AM7
  'ingeniero_obra, maestro_encargado, contacto_nombre, contacto_telefono, ' + // AM10
  'responsable_id, responsable:usuarios(nombre), ' +
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

  // ── AS14 — gastos directos del proyecto (fuera de requisición) ──────────────

  /** Catálogo de categorías de gasto (alimentación, transporte, etc.). */
  async getGastoCategorias(): Promise<GastoCategoria[]> {
    const { data, error } = await this.supabase.client
      .from('gasto_categorias')
      .select('clave, label, orden, activo')
      .eq('activo', true)
      .order('orden');
    if (error) throw new Error(error.message);
    return ((data as Array<Record<string, unknown>>) ?? []).map((c) => ({
      clave: c['clave'] as string,
      label: c['label'] as string,
    }));
  }

  /** ¿Puede el usuario registrar gastos directos en este proyecto? */
  async puedeRegistrarGasto(proyectoId: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('puede_registrar_gasto_directo', {
      p_proyecto_id: proyectoId,
    });
    if (error) return false;
    return !!data;
  }

  /** Historial de gastos directos del proyecto. */
  async gastosDirectos(proyectoId: string, desde: string | null, hasta: string | null): Promise<GastoDirecto[]> {
    const { data, error } = await this.supabase.client.rpc('gastos_directos_de_proyecto', {
      p_proyecto_id: proyectoId,
      p_desde: desde,
      p_hasta: hasta,
    });
    if (error) throw new Error(error.message);
    return ((data as GastoDirecto[]) ?? []).map((g) => ({ ...g, monto: Number(g.monto) }));
  }

  /** Registra un gasto directo (con foto del recibo opcional). Online. */
  async registrarGastoDirecto(input: {
    proyectoId: string;
    categoria: string;
    concepto: string;
    monto: number;
    fecha: string | null;
    recibo?: Blob | null;
  }): Promise<void> {
    const id = crypto.randomUUID();
    let reciboPath: string | null = null;
    if (input.recibo) {
      const path = `gastos/${input.proyectoId}/${id}.jpg`;
      const { error: upErr } = await this.supabase.client.storage
        .from('obra')
        .upload(path, input.recibo, { upsert: true, contentType: 'image/jpeg' });
      if (upErr) throw new Error(upErr.message);
      reciboPath = path;
    }
    const { error } = await this.supabase.client.rpc('registrar_gasto_directo', {
      p_id: id,
      p_proyecto_id: input.proyectoId,
      p_categoria: input.categoria,
      p_concepto: input.concepto,
      p_monto: input.monto,
      p_fecha: input.fecha,
      p_recibo_path: reciboPath,
    });
    if (error) throw new Error(error.message);
  }

  /** AS14 — url firmada del recibo (bucket obra). */
  async reciboUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await this.supabase.client.storage.from('obra').createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  /** AM9 — equipo/responsables de la obra (RPC security-definer, respeta permisos). */
  async responsablesDeProyecto(proyectoId: string): Promise<ResponsableProyecto[]> {
    const { data, error } = await this.supabase.client.rpc('responsables_de_proyecto', {
      p_proyecto_id: proyectoId,
    });
    if (error) throw new Error(error.message);
    return (data as ResponsableProyecto[]) ?? [];
  }

  /**
   * AM7 — resuelve un link de Google Maps (incluidos los cortos maps.app.goo.gl) o
   * un par de coordenadas pegadas a lat/lng. El cliente no puede seguir el redirect
   * (CORS) → lo hace la edge `resolve-maps-link`. Lanza con mensaje claro si falla.
   */
  async resolverUbicacion(entrada: string): Promise<UbicacionResuelta> {
    const { data, error } = await this.supabase.client.functions.invoke('resolve-maps-link', {
      body: { url: entrada },
    });
    if (error) {
      // La edge devuelve el detalle en el body aun con status !=2xx.
      const ctx = (error as { context?: { error?: string } })?.context?.error;
      throw new Error(ctx || 'No se pudo resolver la ubicación. Revisa el link o las coordenadas.');
    }
    const r = data as Partial<UbicacionResuelta> & { error?: string };
    if (r?.error || r?.lat == null || r?.lng == null) {
      throw new Error(r?.error || 'No se pudieron extraer coordenadas.');
    }
    return { lat: r.lat, lng: r.lng, source: (r.source as 'coords' | 'maps_link') ?? 'coords', resolved_url: r.resolved_url ?? null };
  }

  /** AM7 — fija la ubicación estructurada validada (rango + redondeo server-side). */
  async setUbicacion(
    proyectoId: string,
    lat: number,
    lng: number,
    direccion: string | null,
    metodo: string | null,
  ): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_proyecto_ubicacion', {
      p_proyecto_id: proyectoId,
      p_lat: lat,
      p_lng: lng,
      p_direccion: direccion,
      p_metodo: metodo,
    });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CAT_PROYECTOS).catch(() => {});
  }

  /** AM9 — código correlativo PROY-#### (mismo patrón que la web). */
  private async generarCodigo(): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('proyectos')
      .select('codigo')
      .like('codigo', 'PROY-%')
      .order('codigo', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const last = (data?.[0] as { codigo?: string } | undefined)?.codigo;
    const n = last ? parseInt(last.replace('PROY-', ''), 10) || 0 : 0;
    return `PROY-${String(n + 1).padStart(4, '0')}`;
  }

  /**
   * AM9 — crea un proyecto (mismas columnas que la web; código autogenerado).
   * Devuelve el id nuevo para poder fijar su ubicación en el mismo flujo.
   */
  async crearProyecto(input: ProyectoInput): Promise<string> {
    const codigo = await this.generarCodigo();
    const { data, error } = await this.supabase.client
      .from('proyectos')
      .insert({ ...this.payload(input), codigo })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CAT_PROYECTOS).catch(() => {});
    await this.catalog.invalidate(CAT_PICKABLES).catch(() => {});
    return (data as { id: string }).id;
  }

  /** AM9 — edita un proyecto existente. */
  async actualizarProyecto(id: string, input: ProyectoInput): Promise<void> {
    const { error } = await this.supabase.client
      .from('proyectos')
      .update({ ...this.payload(input), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(CAT_PROYECTOS).catch(() => {});
    await this.catalog.invalidate(CAT_PICKABLES).catch(() => {});
  }

  /** Normaliza el payload (trim + null en vacíos) para insert/update. */
  private payload(i: ProyectoInput): Record<string, unknown> {
    const t = (s: string | null) => (s && s.trim() ? s.trim() : null);
    return {
      nombre: i.nombre.trim(),
      cliente: t(i.cliente),
      tipo: t(i.tipo),
      estado: i.estado,
      fecha_inicio: i.fecha_inicio || null,
      fecha_fin_estimada: i.fecha_fin_estimada || null,
      presupuesto: i.presupuesto ?? null,
      descripcion: t(i.descripcion),
      ingeniero_obra: t(i.ingeniero_obra),
      maestro_encargado: t(i.maestro_encargado),
      contacto_nombre: t(i.contacto_nombre),
      contacto_telefono: t(i.contacto_telefono),
      responsable_id: i.responsable_id || null,
    };
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
