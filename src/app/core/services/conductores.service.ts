import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { CatalogService } from '../sync/catalog.service';
import { Conductor, ConductorStats, UsuarioVinculable } from '../models/conductor.model';

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

  /**
   * P8 — genera el acceso a la app (usuario cédula + PIN de 6 dígitos) o lo
   * restablece si ya existe (idempotente). Llama la MISMA edge que la web
   * (`conductor-crear-acceso`, gated a admin/flota). Online-only.
   */
  async generarAccesoConductor(
    conductorId: string,
    pin: string,
  ): Promise<{ email: string; usuarioId: string; created?: boolean; rotated?: boolean }> {
    const { data, error } = await this.supabase.client.functions.invoke('conductor-crear-acceso', {
      body: { conductorId, pin },
    });
    if (error) {
      // La edge devuelve el detalle en el body aunque el status sea 4xx.
      let msg = error.message ?? 'No se pudo generar el acceso.';
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json();
          if (body?.error) msg = body.error;
        } catch {
          /* sin cuerpo JSON útil */
        }
      }
      throw new Error(msg);
    }
    if (data?.error) throw new Error(data.error);
    return data as { email: string; usuarioId: string; created?: boolean; rotated?: boolean };
  }

  /** The current user's conductor row, or null if they aren't a registered driver. */
  async getMiConductor(): Promise<Conductor | null> {
    const data = await this.catalog.refresh<Conductor | null>(CATALOG_MI_CONDUCTOR, async () => {
      const { data: userData } = await this.supabase.client.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return null;
      // Robusto ante duplicados: si por datos hay >1 conductor activo ligado al
      // mismo usuario, tomamos el más reciente (antes .maybeSingle() reventaba
      // con "multiple rows" y la app decía "no eres conductor").
      const { data, error } = await this.supabase.client
        .from('conductores')
        .select(
          'id, nombre, cedula, licencia_tipo, licencia_numero, licencia_vencimiento, tipo_vehiculo_autorizado, vehiculo_id, usuario_id, nota, tags',
        )
        .eq('usuario_id', uid)
        .eq('activo', true)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      return ((data as Conductor[]) ?? [])[0] ?? null;
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

  /** All active drivers for the browse/profile list (flota-gated), cached. */
  async getConductores(): Promise<Conductor[]> {
    const data = await this.catalog.refresh<Conductor[]>('conductores_lista', async () => {
      const { data, error } = await this.supabase.client
        .from('conductores')
        .select(
          'id, nombre, cedula, licencia_tipo, licencia_numero, licencia_vencimiento, tipo_vehiculo_autorizado, vehiculo_id, usuario_id, nota, tags',
        )
        .eq('activo', true)
        .order('nombre', { ascending: true });
      if (error) throw new Error(error.message);
      return (data as Conductor[]) ?? [];
    });
    return data ?? [];
  }

  /** System users that can be linked to a driver (usuarios_vinculables RPC). */
  async getUsuariosVinculables(): Promise<UsuarioVinculable[]> {
    const { data, error } = await this.supabase.client.rpc('usuarios_vinculables');
    if (error) throw new Error(error.message);
    return (data as UsuarioVinculable[]) ?? [];
  }

  /**
   * Alta de conductor (gestión, gated por RLS is_admin OR flota). Puede quedar
   * ligado a un usuario del sistema (usuario_id) — paridad con la web. Requiere
   * conexión (escritura directa, no outbox). Refresca la lista cacheada.
   */
  async crearConductor(input: {
    nombre: string;
    cedula: string;
    licenciaTipo: string;
    licenciaNumero: string | null;
    licenciaVencimiento: string | null; // YYYY-MM-DD
    tipoVehiculoAutorizado: string;
    usuarioId: string | null;
    nota?: string | null;
    tags?: string[] | null;
    esPrueba?: boolean;
  }): Promise<string> {
    const { data, error } = await this.supabase.client
      .from('conductores')
      .insert({
        nombre: input.nombre.trim(),
        cedula: input.cedula.trim(),
        licencia_tipo: input.licenciaTipo.trim(),
        licencia_numero: input.licenciaNumero?.trim() || null,
        licencia_vencimiento: input.licenciaVencimiento || null,
        tipo_vehiculo_autorizado: input.tipoVehiculoAutorizado || 'Ambos',
        usuario_id: input.usuarioId || null,
        nota: input.nota?.trim() || null,
        tags: input.tags && input.tags.length ? input.tags : null,
        es_prueba: input.esPrueba ?? false, // W7
        activo: true,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    await this.getConductores(); // re-warm the cached list
    return (data as { id: string }).id;
  }

  /** A single driver row by id (for the edit form prefill). */
  async getConductor(id: string): Promise<Conductor | null> {
    if (!id) return null;
    const { data, error } = await this.supabase.client
      .from('conductores')
      .select(
        'id, nombre, cedula, licencia_tipo, licencia_numero, licencia_vencimiento, tipo_vehiculo_autorizado, vehiculo_id, usuario_id, nota, tags, es_prueba',
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as Conductor) ?? null;
  }

  /** Update an existing driver (gestión, gated is_admin OR flota). */
  async actualizarConductor(
    id: string,
    input: {
      nombre: string;
      cedula: string;
      licenciaTipo: string;
      licenciaNumero: string | null;
      licenciaVencimiento: string | null;
      tipoVehiculoAutorizado: string;
      usuarioId: string | null;
      nota?: string | null;
      tags?: string[] | null;
      esPrueba?: boolean;
    },
  ): Promise<void> {
    const { error } = await this.supabase.client
      .from('conductores')
      .update({
        nombre: input.nombre.trim(),
        cedula: input.cedula.trim(),
        licencia_tipo: input.licenciaTipo.trim(),
        licencia_numero: input.licenciaNumero?.trim() || null,
        licencia_vencimiento: input.licenciaVencimiento || null,
        tipo_vehiculo_autorizado: input.tipoVehiculoAutorizado || 'Ambos',
        usuario_id: input.usuarioId || null,
        nota: input.nota?.trim() || null,
        tags: input.tags && input.tags.length ? input.tags : null,
        es_prueba: input.esPrueba ?? false, // W7
      })
      .eq('id', id);
    if (error) throw new Error(error.message);
    await this.getConductores();
    await this.getMiConductor();
  }

  /** Activate/deactivate a driver (gestión). */
  async setConductorActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await this.supabase.client.from('conductores').update({ activo }).eq('id', id);
    if (error) throw new Error(error.message);
    await this.getConductores();
  }

  /** Aggregated stats for ANY driver (v_conductor_stats), cached per id. */
  async getStatsDe(conductorId: string): Promise<ConductorStats | null> {
    if (!conductorId) return null;
    const data = await this.catalog.refresh<ConductorStats | null>(
      `conductor_stats:${conductorId}`,
      async () => {
        const { data, error } = await this.supabase.client
          .from('v_conductor_stats')
          .select('*')
          .eq('conductor_id', conductorId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data as ConductorStats) ?? null;
      },
    );
    return data ?? null;
  }

  /**
   * C7 — resumen de documentos por conductor (v_conductor_documentos): qué
   * conductores tienen cédula/licencia, para pintar el badge "Documentos
   * incompletos" en el listado sin abrir cada perfil. Cacheado offline.
   */
  async getDocumentosResumen(): Promise<Record<string, { tiene_cedula: boolean; tiene_licencia: boolean }>> {
    const data = await this.catalog.refresh<
      Record<string, { tiene_cedula: boolean; tiene_licencia: boolean }>
    >('conductor_documentos_resumen', async () => {
      const { data, error } = await this.supabase.client
        .from('v_conductor_documentos')
        .select('conductor_id, tiene_cedula, tiene_licencia');
      if (error) throw new Error(error.message);
      const map: Record<string, { tiene_cedula: boolean; tiene_licencia: boolean }> = {};
      for (const r of (data as Array<{ conductor_id: string; tiene_cedula: boolean; tiene_licencia: boolean }>) ??
        []) {
        map[r.conductor_id] = { tiene_cedula: !!r.tiene_cedula, tiene_licencia: !!r.tiene_licencia };
      }
      return map;
    });
    return data ?? {};
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
