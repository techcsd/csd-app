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

  /**
   * DO1 — posición de la burbuja elegida por el usuario (arrastre), por
   * DISPOSITIVO (localStorage, no se sincroniza entre dispositivos). null =
   * sin preferencia → posición por defecto (abajo-derecha) del CSS.
   */
  posicion = signal<{ left: number; top: number } | null>(this.leerPosicionGuardada());

  /**
   * DO1b — cuánto empuja la burbuja hacia arriba (px) la pantalla activa para
   * no tapar su propio footer de acción fijo (compose de Mensajes, CTA de los
   * wizards). 0 = posición normal. Cada pantalla lo reserva al entrar y lo
   * libera al salir — ver `reservarEspacioCompa()` en shared/util.
   */
  reservadoPx = signal(0);

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

  /** DO1 — guarda la posición elegida al soltar el arrastre (por dispositivo). */
  guardarPosicion(pos: { left: number; top: number } | null): void {
    this.posicion.set(pos);
    try {
      if (pos) localStorage.setItem(POSICION_KEY, JSON.stringify(pos));
      else localStorage.removeItem(POSICION_KEY);
    } catch {
      /* best-effort: sin storage, se queda solo en memoria de la sesión */
    }
  }

  private leerPosicionGuardada(): { left: number; top: number } | null {
    try {
      const raw = localStorage.getItem(POSICION_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { left?: unknown; top?: unknown };
      if (typeof p.left === 'number' && typeof p.top === 'number') return { left: p.left, top: p.top };
      return null;
    } catch {
      return null;
    }
  }

  /** DO1b — reserva/libera el espacio que empuja la burbuja hacia arriba. */
  reservarEspacio(px: number): void {
    this.reservadoPx.set(px);
  }
  liberarEspacio(): void {
    this.reservadoPx.set(0);
  }
}

const POSICION_KEY = 'csd_compa_flotante_pos';
