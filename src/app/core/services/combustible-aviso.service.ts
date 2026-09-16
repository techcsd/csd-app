import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { OutboxOp } from '../db/app-db';

/**
 * BR6 corolario (regla 15) — "Avisar a Logística" desde una echada rechazada por
 * NEGOCIO. Cuando el chofer echó gasolina de verdad pero el sistema no acepta el
 * dato (galones sobre la capacidad del tanque, precio fuera de banda…) y él no
 * puede corregirlo, este servicio le manda a Logística (Raykler) el resumen de la
 * echada para que la registre él. Reutiliza `notificar_modulo('flota', …)` del
 * padre a través del RPC `combustible_avisar_revision`.
 *
 * Contrato del padre (SGC): `combustible_avisar_revision(p_resumen text,
 * p_echada_id uuid default null)` security definer, gate módulo flota → notifica a
 * Logística. Se llama detrás de una comprobación de capacidad: si el RPC aún no
 * está desplegado, el error se propaga y la UI le dice al chofer que se lo comente
 * a Logística de palabra (nunca se rompe la pantalla).
 */
@Injectable({ providedIn: 'root' })
export class CombustibleAvisoService {
  private supabase = inject(SupabaseService);

  /** Construye un resumen legible de la echada desde el payload del outbox. */
  private resumenDe(op: OutboxOp): string {
    const p = (op.payload ?? {}) as Record<string, unknown>;
    const placa = (p['placa'] as string) || '';
    const galones = (p['galones'] as number | null) ?? null;
    const km = (p['kilometraje'] as number | null) ?? null;
    const fecha = (p['fecha'] as string) || '';
    const partes: string[] = ['Echada rechazada que necesita registro de Logística:'];
    if (placa) partes.push(`placa ${placa}`);
    if (galones != null) partes.push(`${galones} gal`);
    if (km != null) partes.push(`${km} km`);
    if (fecha) partes.push(fecha);
    if (op.error_msg) partes.push(`— motivo: ${op.error_msg}`);
    return partes.join(' · ');
  }

  /** Le avisa a Logística que revise/registre esta echada. Lanza si el RPC no existe. */
  async avisarRevision(op: OutboxOp): Promise<void> {
    const p = (op.payload ?? {}) as Record<string, unknown>;
    const echadaId = (p['id'] as string) || op.id;
    const { error } = await this.supabase.client.rpc('combustible_avisar_revision', {
      p_resumen: this.resumenDe(op),
      p_echada_id: echadaId,
    });
    if (error) {
      // El RPC del padre aún no está desplegado (o la firma difiere): mensaje honesto.
      const msg = /function .* does not exist|not find the function|PGRST202/i.test(error.message || '')
        ? 'El aviso automático aún no está disponible. Coméntale a Logística que registre esta echada.'
        : error.message || 'No se pudo avisar a Logística.';
      throw new Error(msg);
    }
  }
}
