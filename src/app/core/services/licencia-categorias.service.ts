import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';

const CATALOG_LIC_CATEGORIAS = 'licencia_categorias';

/** C1 — a Dominican driver-licence category (sgc.licencia_categorias). */
export interface LicenciaCategoria {
  codigo: string; // '01', '02'…
  nombre: string; // 'Motocicletas', 'Vehículos livianos…'
  clase: string; // 'Liviano' | 'Pesado'
  orden: number;
}

/**
 * C1 — read-through cache of the RD licence-category catalog created in SGC.
 * Cached in the catalog store so the conductor form + labels keep working
 * offline after the first online load (mirrors ConductoresService).
 */
@Injectable({ providedIn: 'root' })
export class LicenciaCategoriasService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  async getCategorias(): Promise<LicenciaCategoria[]> {
    const data = await this.catalog.refresh<LicenciaCategoria[]>(CATALOG_LIC_CATEGORIAS, async () => {
      const { data, error } = await this.supabase.client
        .from('licencia_categorias')
        .select('codigo, nombre, clase, orden')
        .eq('activo', true)
        .order('orden', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as LicenciaCategoria[]) ?? [];
    });
    return data ?? [];
  }

  /** "01 · Motocicletas" for a code, or the raw code if it isn't in the catalog. */
  static label(cat: LicenciaCategoria): string {
    return `${cat.codigo} · ${cat.nombre}`;
  }
}
