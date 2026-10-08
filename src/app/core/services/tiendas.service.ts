import { inject, Injectable, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { LocalStore } from './local-store.service';

/**
 * CI7/CI8 — URLs oficiales de tienda (`sgc.parametros.play_store_url` /
 * `app_store_url`), null hasta que existan las fichas. La app las usa para:
 *  · actualizar por el canal oficial (Play In-App Updates / App Store),
 *  · el aviso del canal apk "ya estamos en Google Play",
 *  · el aviso de la PWA iOS "ya estamos en el App Store".
 *
 * Lectura autenticada de `parametros` (la app ya tiene sesión). Si el rol no tiene
 * grant de lectura, degrada a null (sin avisos) — cero regresión. Se cachea para
 * offline.
 */
@Injectable({ providedIn: 'root' })
export class TiendasService {
  private supabase = inject(SupabaseService);
  private store = inject(LocalStore);

  readonly playUrl = signal<string | null>(null);
  readonly appStoreUrl = signal<string | null>(null);

  constructor() {
    void this.hydrate();
  }

  private norm(v: unknown): string | null {
    const s = String(v ?? '').trim();
    return s || null;
  }

  private async hydrate(): Promise<void> {
    try {
      const p = await this.store.get('tienda_play_url');
      const a = await this.store.get('tienda_appstore_url');
      if (p) this.playUrl.set(p);
      if (a) this.appStoreUrl.set(a);
    } catch {
      /* best-effort */
    }
  }

  /** Relee las URLs del servidor (autenticado) y actualiza la cache. No lanza. */
  async refrescar(): Promise<void> {
    try {
      const { data, error } = await this.supabase.client
        .from('parametros')
        .select('clave, valor')
        .in('clave', ['play_store_url', 'app_store_url']);
      if (error) return; // sin grant / offline: deja lo cacheado (o null)
      for (const row of (data as Array<{ clave: string; valor: unknown }>) ?? []) {
        const v = this.norm(row.valor);
        if (row.clave === 'play_store_url') {
          this.playUrl.set(v);
          void this.store.set('tienda_play_url', v ?? '');
        } else if (row.clave === 'app_store_url') {
          this.appStoreUrl.set(v);
          void this.store.set('tienda_appstore_url', v ?? '');
        }
      }
    } catch {
      /* best-effort */
    }
  }
}
