import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'csd-theme';

/**
 * ThemeService — tema claro/oscuro por usuario en la app móvil.
 *
 * Paridad con la web: la preferencia se guarda server-side en el MISMO backend
 * (RPCs `mi_tema`/`set_tema`, tabla sgc.usuario_preferencias) → si el usuario
 * pone oscuro en la web, la app lo hereda y viceversa. localStorage pinta al
 * instante (sin parpadeo, junto al script del index.html) y el servidor
 * sincroniza en best-effort. Default: claro (mejor para sol).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private supabase = inject(SupabaseService);

  private _theme = signal<Theme>(this.readCached());
  readonly theme = this._theme.asReadonly();
  readonly isDark = computed(() => this._theme() === 'dark');

  constructor() {
    this.applyToDom(this._theme());
    // Reconcilia con la preferencia server-side (compartida con la web) al
    // haber sesión (inicial / login / refresh). Best-effort.
    this.supabase.client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') void this.syncFromServer();
    });
  }

  private readCached(): Theme {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  private cache(t: Theme): void {
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  private applyToDom(t: Theme): void {
    document.documentElement.setAttribute('data-theme', t);
    // BH5 — el theme-color (barra de estado / chrome del PWA) sigue al tema.
    const meta = document.getElementById('theme-color-meta');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#2e5586' : '#1e3a5f');
  }

  async syncFromServer(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client.rpc('mi_tema');
      if (error) return;
      const serverTheme: Theme = data === 'oscuro' ? 'dark' : 'light';
      if (serverTheme !== this._theme()) {
        this._theme.set(serverTheme);
        this.applyToDom(serverTheme);
        this.cache(serverTheme);
      }
    } catch {
      /* RPC ausente / sin red → localStorage sigue mandando */
    }
  }

  async set(t: Theme): Promise<void> {
    this._theme.set(t);
    this.applyToDom(t);
    this.cache(t);
    try {
      await this.supabase.client.rpc('set_tema', { p_tema: t === 'dark' ? 'oscuro' : 'claro' });
    } catch {
      /* sin red: queda guardado por dispositivo, se reintenta al próximo cambio */
    }
  }

  toggle(): void {
    void this.set(this.isDark() ? 'light' : 'dark');
  }
}
