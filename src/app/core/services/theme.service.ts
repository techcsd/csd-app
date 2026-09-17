import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';

/** Tema RESUELTO que se pinta (lo que el DOM entiende). */
export type Theme = 'light' | 'dark';
/** Preferencia del usuario (BS3): claro | oscuro | sistema (sigue al dispositivo). */
export type ThemePref = 'claro' | 'oscuro' | 'sistema';

/** localStorage: el RESUELTO (para el script anti-parpadeo de index.html). */
const STORAGE_KEY = 'csd-theme';
/** localStorage: la PREFERENCIA (claro|oscuro|sistema). */
const PREF_KEY = 'csd-theme-pref';

/**
 * ThemeService — apariencia por usuario (BS3: claro / oscuro / **sistema**).
 *
 * Paridad con la web: la preferencia se guarda server-side en el MISMO backend
 * (tabla sgc.usuario_preferencias). El idioma canónico y el tema viven ahí; el
 * contrato PROMPT-54 F3 (`mis_preferencias()` / `set_mi_preferencia('tema',…)`)
 * admite 'sistema'. Se lee/escribe **detrás de comprobación de capacidad**: si esa
 * RPC aún no existe, se degrada al contrato BE6 (`mi_tema`/`set_tema`, solo
 * claro/oscuro) sin romper nada.
 *
 * 'sistema' resuelve al tema del dispositivo (prefers-color-scheme) y se re-resuelve
 * en vivo si el usuario cambia el tema del sistema. localStorage guarda el tema
 * RESUELTO para el script anti-parpadeo del index.html (que solo entiende dark/light).
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private supabase = inject(SupabaseService);

  private _pref = signal<ThemePref>(this.readCachedPref());
  private _theme = signal<Theme>(this.resolve(this._pref()));

  /** Preferencia elegida (para pintar el selector de Apariencia). */
  readonly pref = this._pref.asReadonly();
  /** Tema resuelto que se está pintando. */
  readonly theme = this._theme.asReadonly();
  readonly isDark = computed(() => this._theme() === 'dark');

  private mql: MediaQueryList | null = null;

  constructor() {
    this.applyToDom(this._theme());

    // Re-resolver 'sistema' en vivo cuando cambie el tema del dispositivo.
    try {
      this.mql = window.matchMedia('(prefers-color-scheme: dark)');
      this.mql.addEventListener('change', () => {
        if (this._pref() === 'sistema') this.applyResolved();
      });
    } catch {
      /* sin matchMedia (entornos viejos) → 'sistema' cae a claro */
    }

    // Reconcilia con la preferencia server-side (compartida con la web) al haber
    // sesión (inicial / login / refresh). Best-effort.
    this.supabase.client.auth.onAuthStateChange((event) => {
      if (event !== 'SIGNED_OUT') void this.syncFromServer();
    });
  }

  private prefersDark(): boolean {
    try {
      return this.mql ? this.mql.matches : window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  private resolve(pref: ThemePref): Theme {
    if (pref === 'sistema') return this.prefersDark() ? 'dark' : 'light';
    return pref === 'oscuro' ? 'dark' : 'light';
  }

  private readCachedPref(): ThemePref {
    try {
      const p = localStorage.getItem(PREF_KEY);
      if (p === 'claro' || p === 'oscuro' || p === 'sistema') return p;
      // Retrocompat: sin pref guardada, deriva del tema resuelto antiguo.
      return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'oscuro' : 'claro';
    } catch {
      return 'claro';
    }
  }

  private cache(pref: ThemePref, theme: Theme): void {
    try {
      localStorage.setItem(PREF_KEY, pref);
      localStorage.setItem(STORAGE_KEY, theme); // el anti-parpadeo lee el RESUELTO
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

  /** Recalcula el tema resuelto desde la preferencia actual y lo aplica/cachea. */
  private applyResolved(): void {
    const t = this.resolve(this._pref());
    this._theme.set(t);
    this.applyToDom(t);
    this.cache(this._pref(), t);
  }

  /** Mapea la preferencia canónica del servidor (es/en no; aquí tema) a ThemePref. */
  private toPref(v: unknown): ThemePref | null {
    return v === 'claro' || v === 'oscuro' || v === 'sistema' ? v : null;
  }

  async syncFromServer(): Promise<void> {
    // 1) Contrato nuevo (BS3): admite 'sistema'. Detrás de capacidad.
    try {
      const { data, error } = await this.supabase.client.rpc('mis_preferencias');
      if (!error && data) {
        const pref = this.toPref((data as { tema?: unknown }).tema);
        if (pref && pref !== this._pref()) {
          this._pref.set(pref);
          this.applyResolved();
        }
        return; // capacidad presente → no hace falta el fallback legacy
      }
    } catch {
      /* sin capacidad / sin red → intenta el contrato legacy */
    }
    // 2) Fallback BE6 (solo claro/oscuro).
    try {
      const { data, error } = await this.supabase.client.rpc('mi_tema');
      if (error) return;
      const pref: ThemePref = data === 'oscuro' ? 'oscuro' : 'claro';
      if (pref !== this._pref()) {
        this._pref.set(pref);
        this.applyResolved();
      }
    } catch {
      /* RPC ausente / sin red → localStorage sigue mandando */
    }
  }

  /** BS3 — fija la preferencia de apariencia (claro|oscuro|sistema). */
  async setPref(pref: ThemePref): Promise<void> {
    this._pref.set(pref);
    this.applyResolved();
    // Servidor: contrato nuevo primero (admite 'sistema'); si no hay capacidad y la
    // pref es concreta, cae al legacy set_tema. Best-effort/offline.
    try {
      const { error } = await this.supabase.client.rpc('set_mi_preferencia', {
        p_clave: 'tema',
        p_valor: pref,
      });
      if (!error) return;
    } catch {
      /* sin capacidad → fallback */
    }
    if (pref !== 'sistema') {
      try {
        await this.supabase.client.rpc('set_tema', { p_tema: pref === 'oscuro' ? 'oscuro' : 'claro' });
      } catch {
        /* offline: queda por dispositivo, se reintenta al próximo cambio */
      }
    }
  }

  /** Compat binaria (BE6): usada por callers antiguos; mapea a la preferencia. */
  async set(t: Theme): Promise<void> {
    await this.setPref(t === 'dark' ? 'oscuro' : 'claro');
  }

  toggle(): void {
    void this.set(this.isDark() ? 'light' : 'dark');
  }
}
