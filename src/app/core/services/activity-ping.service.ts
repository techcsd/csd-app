import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { environment } from '../../../environments/environment';

/**
 * W12 — "ping" de actividad: marca al usuario como activo en el canal 'app' al
 * abrir la app y al volver del segundo plano (resume). Best-effort:
 *  - throttle client-side (~5 min) para no spamear el servidor,
 *  - solo con sesión iniciada y con señal,
 *  - NO usa outbox (si estás offline, basta el próximo ping online).
 * Cualquier error se ignora: jamás debe estorbar al trabajo de campo.
 */
@Injectable({ providedIn: 'root' })
export class ActivityPingService {
  private supabase = inject(SupabaseService);
  private network = inject(NetworkService);

  private readonly THROTTLE_MS = 5 * 60 * 1000;
  private last = 0;
  private bound = false;

  init(): void {
    if (this.bound) return;
    this.bound = true;
    void this.ping();
    // Resume nativo (Android) + visibilitychange (PWA/WebView) → app en primer plano.
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('resume', () => void this.ping());
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.ping();
      });
    }
  }

  private async ping(): Promise<void> {
    if (!this.network.online()) return;
    const now = Date.now();
    if (now - this.last < this.THROTTLE_MS) return;
    try {
      const { data } = await this.supabase.client.auth.getSession();
      if (!data.session) return; // sin sesión no hay a quién marcar activo
      this.last = now;
      // X9-app — el RPC devuelve el error en el resultado (no lanza). Lo
      // inspeccionamos para diagnosticar (dev) por qué "Última vez en app" no
      // se actualizaba, sin dejar de ser best-effort en prod.
      const { error } = await this.supabase.client.rpc('ping_actividad', { p_canal: 'app' });
      if (error && !environment.production) {
        // eslint-disable-next-line no-console
        console.warn('[ActivityPing] ping_actividad falló:', error.code, error.message);
      }
    } catch (e) {
      // best-effort: nunca estorbar; solo diagnosticamos en dev.
      if (!environment.production) {
        // eslint-disable-next-line no-console
        console.warn('[ActivityPing] excepción al hacer ping:', e);
      }
    }
  }
}
