import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { SupabaseService } from './supabase.service';
import { NetworkService } from './network.service';
import { DeviceInfoService } from './device-info.service';
import { environment } from '../../../environments/environment';

/** Plataforma normalizada que entiende el backend (`set_mi_plataforma`). */
export type PlataformaReportada = 'android' | 'ios' | 'ios-pwa' | 'web';

/**
 * AP7 — reporta AUTOMÁTICAMENTE la plataforma del dispositivo del usuario al iniciar
 * sesión / sincronizar, para que Conductores (web) muestre si el chofer usa Android o
 * iPhone (PWA) sin capturarlo a mano. Best-effort, silencioso, sin fricción:
 *  - solo con sesión y señal,
 *  - una vez por arranque (throttle largo por si cambia de red),
 *  - jamás estorba el trabajo de campo (errores ignorados).
 */
@Injectable({ providedIn: 'root' })
export class PlatformReportService {
  private supabase = inject(SupabaseService);
  private network = inject(NetworkService);
  private device = inject(DeviceInfoService);

  private done = false;
  private bound = false;

  init(): void {
    if (this.bound) return;
    this.bound = true;
    void this.report();
    // Si arrancó sin sesión/sin red, reintenta al volver al frente.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.report();
      });
    }
  }

  /** Clasifica la plataforma: nativo → android/ios; web iOS → ios-pwa; resto → web. */
  private plataforma(): PlataformaReportada {
    const p = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
    if (Capacitor.isNativePlatform()) {
      return p === 'ios' ? 'ios' : 'android';
    }
    // Web: distinguir un iPhone/iPad (PWA o Safari) del resto de la web.
    const ua = navigator.userAgent || '';
    const iOS =
      /iPad|iPhone|iPod/.test(ua) ||
      // iPadOS 13+ se presenta como Mac con pantalla táctil.
      (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && (navigator.maxTouchPoints ?? 0) > 1);
    return iOS ? 'ios-pwa' : 'web';
  }

  private async report(): Promise<void> {
    if (this.done) return;
    if (!this.network.online()) return;
    try {
      const { data } = await this.supabase.client.auth.getSession();
      if (!data.session) return; // sin sesión no hay a quién marcar
      const info = await this.device.ready();
      const { error } = await this.supabase.client.rpc('set_mi_plataforma', {
        p_plataforma: this.plataforma(),
        p_modelo: info.model ?? null,
      });
      if (error) {
        if (!environment.production) console.warn('[PlatformReport] set_mi_plataforma:', error.code, error.message);
        return; // no marcar done → reintenta luego
      }
      this.done = true;
    } catch (e) {
      if (!environment.production) console.warn('[PlatformReport] excepción:', e);
    }
  }
}
