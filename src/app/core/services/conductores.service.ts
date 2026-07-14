import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { Conductor, ConductorStats } from '../models/conductor.model';

const CATALOG_MI_CONDUCTOR = 'mi_conductor';
const CATALOG_MI_STATS = 'mi_conductor_stats';
const CATALOG_FLOTA_CONFIG = 'flota_config';

export interface FlotaConfig {
  precitaKm: number;
  licenciaDias: number;
  consumoPct: number;
}
const FLOTA_CONFIG_DEFAULT: FlotaConfig = { precitaKm: 500, licenciaDias: 30, consumoPct: 20 };

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

  /**
   * Auto-registro sin fricción (R2): crea/actualiza el perfil de conductor
   * ligado al usuario actual. Requiere conexión. Refresca la caché de mi
   * conductor para que el resto del flujo (asignación, pre-uso) lo vea.
   */
  async autoRegistrar(input: {
    cedula: string;
    licenciaTipo: string;
    licenciaNumero: string | null;
    licenciaVencimiento: string | null; // YYYY-MM-DD
    tipoVehiculoAutorizado: string; // Liviano | Pesado | Ambos
  }): Promise<{ conductor_id: string; licencia_vencida: boolean; licencia_vencimiento: string | null }> {
    const { data, error } = await this.supabase.client.rpc('auto_registrar_conductor', {
      p_cedula: input.cedula.trim(),
      p_licencia_tipo: input.licenciaTipo.trim(),
      p_licencia_numero: input.licenciaNumero?.trim() || null,
      p_licencia_vencimiento: input.licenciaVencimiento || null,
      p_tipo_vehiculo_autorizado: input.tipoVehiculoAutorizado || 'Ambos',
    });
    if (error) throw new Error(error.message);
    // Re-fetch so getMiConductor() returns the fresh profile.
    await this.getMiConductor();
    return data as { conductor_id: string; licencia_vencida: boolean; licencia_vencimiento: string | null };
  }

  /** The signed-in driver's aggregated stats (v_conductor_stats, R5), cached. */
  async getMiStats(): Promise<ConductorStats | null> {
    const cond = await this.getMiConductor();
    if (!cond) return null;
    const data = await this.catalog.refresh<ConductorStats | null>(CATALOG_MI_STATS, async () => {
      const { data, error } = await this.supabase.client
        .from('v_conductor_stats')
        .select('*')
        .eq('conductor_id', cond.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as ConductorStats) ?? null;
    });
    return data ?? null;
  }

  /** Umbrales configurables de Flota (sgc.flota_config), cacheados offline. */
  async getFlotaConfig(): Promise<FlotaConfig> {
    const data = await this.catalog.refresh<FlotaConfig>(CATALOG_FLOTA_CONFIG, async () => {
      const { data, error } = await this.supabase.client.from('flota_config').select('clave, valor');
      if (error) throw new Error(error.message);
      const m = new Map((data ?? []).map((r: { clave: string; valor: string }) => [r.clave, Number(r.valor)]));
      const val = (k: string, d: number) => {
        const n = m.get(k);
        return n != null && !Number.isNaN(n) ? n : d;
      };
      return {
        precitaKm: val('umbral_precita_km', FLOTA_CONFIG_DEFAULT.precitaKm),
        licenciaDias: val('umbral_licencia_dias', FLOTA_CONFIG_DEFAULT.licenciaDias),
        consumoPct: val('umbral_consumo_pct', FLOTA_CONFIG_DEFAULT.consumoPct),
      };
    });
    return data ?? FLOTA_CONFIG_DEFAULT;
  }
}
