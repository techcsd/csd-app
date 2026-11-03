import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/**
 * DG6 — "Compa flotante": preferencia por usuario (server-side, MISMO campo que la
 * web — `sgc.usuario_preferencias.compa_flotante`, contrato `mis_preferencias()` /
 * `set_mi_preferencia('compa_flotante', …)`, ya desplegado en dev por la ronda DG
 * del padre). Apagarlo en un dispositivo lo apaga en todos (es una preferencia de
 * la PERSONA, no del teléfono) — igual que el tema o el idioma.
 *
 * `abierta` es solo UI local (la hoja está abierta o cerrada en ESTE momento, en
 * ESTE dispositivo): no tiene sentido sincronizarla entre dispositivos.
 */
@Injectable({ providedIn: 'root' })
export class CompaFlotanteService {
  private supabase = inject(SupabaseService);

  /** true por defecto (mismo default que el servidor) hasta que se confirme lo contrario. */
  activo = signal(true);
  abierta = signal(false);

  constructor() {
    this.supabase.client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') void this.sincronizar();
    });
  }

  /** Best-effort: si la RPC aún no existe en el entorno, se queda en el default (true). */
  async sincronizar(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('mis_preferencias');
      if (error || !data) return;
      const v = (data as { compa_flotante?: unknown }).compa_flotante;
      if (typeof v === 'boolean') this.activo.set(v);
    } catch {
      /* sin capacidad / sin red → queda el valor conocido */
    }
  }

  abrir(): void {
    if (!this.activo()) return;
    this.abierta.set(true);
  }

  cerrar(): void {
    this.abierta.set(false);
  }

  /** Configuración (Perfil) — enciende/apaga la burbuja para la persona. */
  async setActivo(valor: boolean): Promise<void> {
    this.activo.set(valor);
    if (!valor) this.abierta.set(false);
    const { error } = await this.supabase.client.rpc('set_mi_preferencia', {
      p_clave: 'compa_flotante',
      p_valor: String(valor),
    });
    if (error) throw new Error(error.message);
  }
}
