import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { Conductor } from '../models/conductor.model';

const CATALOG_MI_CONDUCTOR = 'mi_conductor';

/**
 * Resolves the signed-in user's driver profile (sgc.conductores linked by
 * usuario_id = auth uid). Cached in the catalog so pre-use licence blocks keep
 * working offline after the first online load. Mirrors VehiculosService.
 */
@Injectable({ providedIn: 'root' })
export class ConductoresService {
  private supabase = inject(SupabaseService);
  private catalog = inject(CatalogService);

  /** The current user's conductor row, or null if they aren't a registered driver. */
  async getMiConductor(): Promise<Conductor | null> {
    const data = await this.catalog.refresh<Conductor | null>(CATALOG_MI_CONDUCTOR, async () => {
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      const { data, error } = await this.supabase.client
        .from('conductores')
        .select(
          'id, nombre, cedula, licencia_tipo, licencia_numero, licencia_vencimiento, tipo_vehiculo_autorizado, vehiculo_id, usuario_id',
        )
        .eq('usuario_id', uid)
        .eq('activo', true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Conductor) ?? null;
    });
    return data ?? null;
  }
}
