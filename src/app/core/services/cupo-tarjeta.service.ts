import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { SolicitarCupoInput, SolicitudCupo, TarjetaConsumo } from '../models/cupo-tarjeta.model';

/**
 * DI — "cupo de tarjeta de combustible" (solicitud manual + cupo opcional por
 * tarjeta). Backend YA EN PROD (no tocar los RPCs). No pasa por el outbox: son
 * llamadas livianas que requieren conectividad, igual que log_combustible /
 * echadas_por_aprobar en CombustibleService.
 */
@Injectable({ providedIn: 'root' })
export class CupoTarjetaService {
  private supabase = inject(SupabaseService);

  /** La tarjeta mapeada a este vehículo + su consumo del período, o null si no hay nada que mostrar. */
  async miTarjeta(vehiculoId: string): Promise<TarjetaConsumo | null> {
    const { data, error } = await this.supabase.client.rpc('mi_tarjeta_vehiculo', { p_vehiculo_id: vehiculoId });
    if (error) throw new Error(error.message);
    const rows = (data as TarjetaConsumo[]) ?? [];
    return rows[0] ?? null;
  }

  /** Pide ampliar el cupo de una tarjeta. Reenviar mientras hay una pendiente devuelve la misma (anti-duplicado del server). */
  async solicitar(input: SolicitarCupoInput): Promise<void> {
    const { error } = await this.supabase.client.rpc('solicitar_cupo_tarjeta', {
      p_codigo_tarjeta: input.codigoTarjeta,
      p_vehiculo_id: input.vehiculoId ?? null,
      p_galones: input.galones ?? null,
      p_monto: input.monto ?? null,
      p_motivo: input.motivo,
      p_nota: input.nota ?? null,
      p_foto_rechazo_path: input.fotoRechazoPath ?? null,
    });
    if (error) throw new Error(error.message);
  }

  /** Cancela una solicitud propia aún pendiente. */
  async cancelar(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('cancelar_solicitud_cupo', { p_solicitud_id: id });
    if (error) throw new Error(error.message);
  }

  /** Mis solicitudes de cupo, más recientes primero. */
  async misSolicitudes(): Promise<SolicitudCupo[]> {
    const { data, error } = await this.supabase.client.rpc('mis_solicitudes_cupo');
    if (error) throw new Error(error.message);
    return (data as SolicitudCupo[]) ?? [];
  }
}
