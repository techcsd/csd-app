import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { UserContextService } from './user-context.service';

export interface Reporte {
  id: string;
  tipo: string;
  asunto: string;
  descripcion: string;
  estado: string;
  respuesta_admin: string | null;
  created_at: string;
  usuario?: { nombre: string } | null;
}

export interface Unidad {
  id: number;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface BCatalogo {
  id: number;
  tipo: 'estructura' | 'actividad' | 'restriccion';
  valor: string;
  activo: boolean;
}

export interface ConteoRow {
  id: string;
  motivo: string | null;
  created_at: string;
  bodega?: { nombre: string } | null;
  creado?: { nombre: string } | null;
  items?: { cantidad_antes: number; cantidad_contada: number; articulo?: { nombre: string } | null }[];
}

export interface AuditoriaRow {
  id: number;
  tabla: string;
  registro_id: string;
  accion: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: string | null;
  actor?: { nombre: string } | null;
  cambios: Record<string, { antes: unknown; despues: unknown }> | null;
  datos_despues: Record<string, unknown> | null;
  datos_antes: Record<string, unknown> | null;
  creado_en: string;
}

/**
 * Admin operations for the in-app Administración section. All writes are gated
 * server-side by RLS (sgc.is_admin()); the UI is additionally gated by the
 * `admin` module.
 */
@Injectable({ providedIn: 'root' })
export class AdminService {
  private supabase = inject(SupabaseService);
  private ctx = inject(UserContextService);

  // ── Reportes ──────────────────────────────────────────────
  async getReportes(): Promise<Reporte[]> {
    const { data, error } = await this.supabase.client
      .from('reportes_usuario')
      .select('id, tipo, asunto, descripcion, estado, respuesta_admin, created_at, usuario:usuarios!reportes_usuario_usuario_id_fkey(nombre)')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data as unknown as Reporte[]) ?? [];
  }

  async resolverReporte(id: string, respuesta: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('reportes_usuario')
      .update({
        estado: 'resuelto',
        respuesta_admin: respuesta.trim() || null,
        asignado_a: this.ctx.profile()?.id,
        resuelto_en: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Unidades ──────────────────────────────────────────────
  async getUnidades(): Promise<Unidad[]> {
    const { data, error } = await this.supabase.client.from('unidades').select('*').order('nombre');
    if (error) throw new Error(error.message);
    return (data as unknown as Unidad[]) ?? [];
  }

  async crearUnidad(nombre: string): Promise<Unidad> {
    const codigo = this.slug(nombre);
    const { data, error } = await this.supabase.client
      .from('unidades')
      .insert({ codigo, nombre: nombre.trim() })
      .select('*')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Ya existe esa unidad.' : error.message);
    return data as unknown as Unidad;
  }

  async toggleUnidad(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('unidades').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Bitácora catálogos ────────────────────────────────────
  async getBCatalogos(): Promise<BCatalogo[]> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .select('*')
      .order('tipo')
      .order('valor');
    if (error) throw new Error(error.message);
    return (data as unknown as BCatalogo[]) ?? [];
  }

  async crearBCatalogo(tipo: string, valor: string): Promise<BCatalogo> {
    const { data, error } = await this.supabase.client
      .from('bitacora_catalogos')
      .insert({ tipo, valor: valor.trim().toUpperCase() })
      .select('*')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'Ese valor ya existe.' : error.message);
    return data as unknown as BCatalogo;
  }

  async toggleBCatalogo(id: number, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('bitacora_catalogos').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ── Conteos (ajustes) history ─────────────────────────────
  async getConteos(): Promise<ConteoRow[]> {
    const { data, error } = await this.supabase.client
      .from('conteos_inventario')
      .select('id, motivo, created_at, bodega:bodegas(nombre), creado:usuarios(nombre), items:conteo_items(cantidad_antes, cantidad_contada, articulo:articulos(nombre))')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data as unknown as ConteoRow[]) ?? [];
  }

  // ── Auditoría (traceability) ──────────────────────────────
  /** Recent change trail (who created/modified/deleted what) from both web and
   *  app. Paginated by page (0-based); accion optionally filters. */
  async getAuditoria(page = 0, accion?: string): Promise<AuditoriaRow[]> {
    const size = 30;
    let q = this.supabase.client
      .from('auditoria')
      .select('*, actor:usuarios!auditoria_actor_id_fkey(nombre)')
      .order('creado_en', { ascending: false })
      .range(page * size, page * size + size - 1);
    if (accion) q = q.eq('accion', accion);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as unknown as AuditoriaRow[]) ?? [];
  }

  private slug(nombre: string): string {
    return nombre
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }
}
