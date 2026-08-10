import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** AK15 — escala del nivel de combustible (confirmada con Xaviel: E,1/4,1/2,3/4,F). */
export type NivelCombustible = 'E' | '1/4' | '1/2' | '3/4' | 'F';
export const NIVELES_COMBUSTIBLE: NivelCombustible[] = ['E', '1/4', '1/2', '3/4', 'F'];

/** AK20 — estado de uso de un vehículo (libre / en uso por alguien). */
export interface EstadoUso {
  libre: boolean;
  usuario_id?: string;
  usuario_nombre?: string;
  desde?: string;
  km_inicio?: number | null;
  nivel_inicio?: NivelCombustible | null;
  es_mio?: boolean;
}

/** AK20 — mi sesión de uso activa (mi_uso_activo). */
export interface UsoActivo {
  uso_id: string;
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  anio: number | null;
  km: number | null;
  km_inicio: number | null;
  nivel_inicio: NivelCombustible | null;
  desde: string;
  recibido_de: string | null;
}

/** AK18 — fila del historial de mis usos de vehículo. */
export interface MiUso {
  id: string;
  vehiculo_id: string;
  placa: string;
  marca: string;
  modelo: string;
  inicio_at: string;
  fin_at: string | null;
  km_inicio: number | null;
  km_fin: number | null;
  nivel_inicio: NivelCombustible | null;
  nivel_fin: NivelCombustible | null;
  recibido_de: string | null;
  activa: boolean;
}

/** AK20 — el vehículo está en uso por OTRO (DR409): la UI ofrece "recibir de X". */
export class VehiculoEnUsoError extends Error {
  constructor(
    public enUsoPor: string | null,
    public nombre: string | null,
    public desde: string | null,
  ) {
    super(`El vehículo está en uso por ${nombre ?? 'otro usuario'}.`);
    this.name = 'VehiculoEnUsoError';
  }
}

/**
 * AK14/AK15/AK20 — modelo "en uso / libre": el acto operativo es "Uso de vehículo".
 * Vehículo libre → abre sesión; en uso por otro → "recibir de X"; al terminar,
 * "soltar". Reemplaza el concepto de asignación. El bridge server-side mantiene
 * `vehiculos.responsable_id` = tenedor, así combustible/reporte semanal siguen.
 */
@Injectable({ providedIn: 'root' })
export class VehiculoUsoService {
  private supabase = inject(SupabaseService);

  /** Estado de uso de un vehículo (libre / en uso por quién). */
  async estadoUso(vehiculoId: string): Promise<EstadoUso> {
    const { data, error } = await this.supabase.client.rpc('estado_uso_vehiculo', {
      p_vehiculo_id: vehiculoId,
    });
    if (error) throw new Error(error.message);
    return (data as EstadoUso) ?? { libre: true };
  }

  /**
   * Inicia (o recibe) el uso de un vehículo. Libre → abre sesión. En uso por mí →
   * `estado='ya_en_uso'`. En uso por OTRO y `recibir=false` → lanza VehiculoEnUsoError
   * (la UI ofrece "recibir de X"); con `recibir=true` cierra la de X y abre la mía.
   */
  async iniciarUso(input: {
    vehiculoId: string;
    km: number | null;
    nivel: NivelCombustible;
    notas?: string | null;
    recibir?: boolean;
  }): Promise<{ ok: boolean; estado: string; uso_id?: string }> {
    const { data, error } = await this.supabase.client.rpc('iniciar_uso_vehiculo', {
      p_vehiculo_id: input.vehiculoId,
      p_km: input.km,
      p_nivel: input.nivel,
      p_notas: input.notas ?? null,
      p_recibir: input.recibir ?? false,
    });
    if (error) {
      if ((error as { code?: string }).code === 'DR409') {
        const d = this.parseDetail((error as { details?: string }).details);
        throw new VehiculoEnUsoError(d?.en_uso_por ?? null, d?.nombre ?? null, d?.desde ?? null);
      }
      throw new Error(error.message);
    }
    return data as { ok: boolean; estado: string; uso_id?: string };
  }

  /** Suelta el vehículo (cierra mi sesión, pide km + nivel). Queda libre. */
  async soltar(input: {
    vehiculoId: string;
    km: number | null;
    nivel: NivelCombustible;
    notas?: string | null;
  }): Promise<{ ok: boolean; estado: string }> {
    const { data, error } = await this.supabase.client.rpc('soltar_vehiculo', {
      p_vehiculo_id: input.vehiculoId,
      p_km: input.km,
      p_nivel: input.nivel,
      p_notas: input.notas ?? null,
    });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; estado: string };
  }

  /** Mi sesión de uso activa (o null). */
  async miUsoActivo(): Promise<UsoActivo | null> {
    const { data, error } = await this.supabase.client.rpc('mi_uso_activo');
    if (error) throw new Error(error.message);
    return (data as UsoActivo | null) ?? null;
  }

  /** AK18 — historial de mis usos de vehículo (Mi actividad). */
  async misUsos(desde?: string | null, hasta?: string | null): Promise<MiUso[]> {
    const { data, error } = await this.supabase.client.rpc('mis_usos_vehiculo', {
      p_desde: desde ?? null,
      p_hasta: hasta ?? null,
    });
    if (error) throw new Error(error.message);
    return (data as MiUso[]) ?? [];
  }

  private parseDetail(details?: string): { en_uso_por?: string; nombre?: string; desde?: string } | null {
    if (!details) return null;
    try {
      return JSON.parse(details);
    } catch {
      return null;
    }
  }
}
