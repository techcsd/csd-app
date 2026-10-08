import { inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';

/**
 * CI10 / CI5 — Consentimientos del usuario, espejo del contrato del padre
 * (PROMPT-86 F5): `mi_consentimiento(p_tipo)` / `set_consentimiento(p_tipo,
 * p_otorgado, p_plataforma)`.
 *
 * - `ia`             → usar el asistente Compa, transcribir notas de voz, leer
 *                      recibos (datos a Anthropic / Groq / OpenAI). Las edges
 *                      también lo verifican (403 `sin_consentimiento_ia`).
 * - `ubicacion_fondo`→ rastreo de ubicación en segundo plano (CI5, prominent
 *                      disclosure antes de pedir "Permitir todo el tiempo").
 *
 * Se cachea en LocalStore para decidir **offline** (el campo no siempre tiene
 * señal): la hoja de consentimiento no debe bloquear a quien ya aceptó.
 */
export type TipoConsentimiento = 'ia' | 'ubicacion_fondo';

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);

  // null = aún no sabemos (ni cache ni server). true/false = valor conocido.
  readonly ia = signal<boolean | null>(null);
  readonly ubicacionFondo = signal<boolean | null>(null);

  constructor() {
    void this.hydrate();
  }

  private key(tipo: TipoConsentimiento): string {
    return `consent_${tipo}`;
  }

  private sig(tipo: TipoConsentimiento) {
    return tipo === 'ia' ? this.ia : this.ubicacionFondo;
  }

  private plataforma(): string {
    return Capacitor.isNativePlatform() ? Capacitor.getPlatform() : 'web';
  }

  /** Carga los valores cacheados al arrancar (offline-first). */
  private async hydrate(): Promise<void> {
    for (const tipo of ['ia', 'ubicacion_fondo'] as TipoConsentimiento[]) {
      try {
        const raw = await this.store.get(this.key(tipo));
        if (raw === '1') this.sig(tipo).set(true);
        else if (raw === '0') this.sig(tipo).set(false);
      } catch {
        /* best-effort */
      }
    }
  }

  /** Valor cacheado (sync, best-effort). null = desconocido. */
  tiene(tipo: TipoConsentimiento): boolean | null {
    return this.sig(tipo)();
  }

  /** Lee el valor del servidor y refresca la cache; si falla, cae a la cache. */
  async refrescar(tipo: TipoConsentimiento): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.rpc('mi_consentimiento', { p_tipo: tipo });
      if (error) throw error;
      const val = data === true;
      this.sig(tipo).set(val);
      void this.store.set(this.key(tipo), val ? '1' : '0');
      return val;
    } catch {
      return this.sig(tipo)() === true; // offline: lo que tengamos en cache
    }
  }

  /** Otorga el consentimiento (set_consentimiento true) y lo cachea. */
  async otorgar(tipo: TipoConsentimiento): Promise<void> {
    this.sig(tipo).set(true);
    void this.store.set(this.key(tipo), '1');
    try {
      await this.supabase.client.rpc('set_consentimiento', {
        p_tipo: tipo,
        p_otorgado: true,
        p_plataforma: this.plataforma(),
      });
    } catch {
      /* el cache ya refleja el consentimiento; el server se reintenta al refrescar */
    }
  }

  /** Revoca el consentimiento (set_consentimiento false) y lo cachea. */
  async revocar(tipo: TipoConsentimiento): Promise<void> {
    this.sig(tipo).set(false);
    void this.store.set(this.key(tipo), '0');
    try {
      await this.supabase.client.rpc('set_consentimiento', {
        p_tipo: tipo,
        p_otorgado: false,
        p_plataforma: this.plataforma(),
      });
    } catch {
      /* best-effort */
    }
  }
}
