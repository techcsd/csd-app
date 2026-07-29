import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { DudaCategoria, GuiaVisual } from '../models/ayuda.model';

interface AyudaRow {
  tipo: 'guia' | 'duda_categoria';
  contenido: GuiaVisual | DudaCategoria;
}

/**
 * Z30 — Contenido de ayuda (Dudas + Guías) desde `sgc.ayuda_contenido`. Misma
 * fuente que la web; cacheado offline por el canal de catálogos (read-through).
 * El filtrado por módulo/rol se hace en la pantalla (igual que la web).
 */
@Injectable({ providedIn: 'root' })
export class AyudaService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  async getContenido(): Promise<{ guias: GuiaVisual[]; categorias: DudaCategoria[] }> {
    const rows = await this.catalog.refresh<AyudaRow[]>('ayuda_contenido', async () => {
      const { data, error } = await this.supabase.client
        .from('ayuda_contenido')
        .select('tipo, contenido, orden')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as AyudaRow[]) ?? [];
    });
    const list = rows ?? [];
    return {
      guias: list.filter((r) => r.tipo === 'guia').map((r) => r.contenido as GuiaVisual),
      categorias: list.filter((r) => r.tipo === 'duda_categoria').map((r) => r.contenido as DudaCategoria),
    };
  }
}
