import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';

const CATALOG_KEY = 'app_module_order';
/** AK2 — clave de caché por scope (home + cada módulo/submódulo). */
const catalogKey = (scope: string) => (scope === 'home' ? CATALOG_KEY : `${CATALOG_KEY}:${scope}`);

/** AJ4 — tamaño de un tile del launcher. */
export type ModuleSize = '1x1' | '2x1' | '2x2';

/** AF38 / AJ4 — una fila de orden+tamaño de módulo (sgc.app_module_order). */
export interface ModuleOrderRow {
  clave: string;
  parent: string | null;
  orden: number;
  size: ModuleSize;
}

/**
 * AF38 — orden de los módulos del home, configurable por el admin y visible para
 * todos. Backend: sgc.get_module_order() (todos leen) + sgc.set_module_order()
 * (solo admin). Cacheado offline para pintar el orden sin conexión.
 */
@Injectable({ providedIn: 'root' })
export class ModuleOrderService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  /** Orden guardado (cache-then-network). Devuelve [] si no hay config.
   *  AK2 — `scope` selecciona la pantalla (home por defecto, o clave de módulo/submódulo). */
  async getOrder(scope = 'home'): Promise<ModuleOrderRow[]> {
    const data = await this.catalog.refresh<ModuleOrderRow[]>(catalogKey(scope), async () => {
      const { data, error } = await this.supabase.client.rpc('get_module_order', { p_scope: scope });
      if (error) throw new Error(error.message);
      return ((data as ModuleOrderRow[]) ?? []).map((r) => ({
        clave: r.clave,
        parent: r.parent ?? null,
        orden: r.orden ?? 0,
        size: (r.size as ModuleSize) ?? '1x1',
      }));
    });
    return data ?? [];
  }

  /** AJ4/AK2 — persiste orden + tamaño por `scope` (admin o quien tenga
   *  plataforma.layout_app; el RPC valida). Invalida la cache del scope. */
  async setOrder(
    items: { clave: string; parent?: string | null; orden: number; size?: ModuleSize }[],
    scope = 'home',
  ): Promise<void> {
    const payload = items.map((it) => ({
      clave: it.clave,
      parent: it.parent ?? null,
      orden: it.orden,
      size: it.size ?? '1x1',
    }));
    const { error } = await this.supabase.client.rpc('set_module_order', { p_items: payload, p_scope: scope });
    if (error) throw new Error(error.message);
    await this.catalog.invalidate(catalogKey(scope));
  }
}
