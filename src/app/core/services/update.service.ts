import { inject, Injectable } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { ToastService } from './toast.service';
import { environment } from '../../../environments/environment';

const VERSION_URL =
  'https://jeeqhgccqefbqilntcpu.supabase.co/storage/v1/object/public/app-releases/version.json';

/**
 * PWA update handling (Deployment doc §3). When the service worker fetches a
 * new version, we activate it and reload so field users always run the latest
 * build. Also exposes a manual check for the Perfil screen. Inert in dev
 * (SW disabled) and on native (APK updates are separate).
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private swUpdate = inject(SwUpdate);
  private toast = inject(ToastService);

  init(): void {
    // PWA (AP8): la web/PWA se actualiza SOLA por el service worker — nunca un botón
    // "Actualizar ahora" (ese gate es solo de la APK nativa; ver version.service).
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((evt) => {
        if (evt.type === 'VERSION_READY') {
          // Toast sutil y auto-aplicar: activar + recargar. Sin fricción, sin prompt.
          this.toast.show('Nueva versión cargada.', 'info', 2500);
          void this.swUpdate.activateUpdate().then(() => {
            setTimeout(() => document.location.reload(), 1500);
          });
        }
      });
      // AP8 — iOS/Safari PWA no chequea el SW por su cuenta de forma fiable (suspende
      // la pestaña). Chequeamos ACTIVAMENTE al arrancar y cada vez que la PWA vuelve al
      // frente, para que un cambio publicado se tome solo (antes se quedaban en un
      // build viejo — el que aún mostraba el prompt de actualizar).
      void this.pull();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.pull();
      });
    }
    // Native (APK): can't self-update — check version.json and nudge the user.
    if (Capacitor.isNativePlatform()) {
      setTimeout(() => void this.checkAppVersion(), 5000);
    }
  }

  /** Best-effort: pide al SW que busque una versión nueva (silencioso si no hay). */
  private async pull(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch {
      /* offline / SW no listo — ignore */
    }
  }

  /** Compares the published versionName to the installed one (native APK). */
  private async checkAppVersion(): Promise<void> {
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const info = (await res.json()) as { versionName: string };
      if (this.isNewer(info.versionName, environment.version)) {
        this.toast.show(
          `Hay una versión nueva (${info.versionName}). Descárgala desde "CSD App" en el sistema.`,
          'info',
          6000,
        );
      }
    } catch {
      /* offline — ignore */
    }
  }

  private isNewer(remote: string, local: string): boolean {
    const r = remote.split('.').map(Number);
    const l = local.split('.').map(Number);
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      if ((r[i] ?? 0) > (l[i] ?? 0)) return true;
      if ((r[i] ?? 0) < (l[i] ?? 0)) return false;
    }
    return false;
  }

  /** Manual "Buscar actualización" from Perfil. */
  async check(): Promise<void> {
    if (!this.swUpdate.isEnabled) {
      this.toast.success('Ya tienes la última versión.');
      return;
    }
    const found = await this.swUpdate.checkForUpdate();
    if (!found) this.toast.success('Ya tienes la última versión.');
    // If found, the VERSION_READY handler above takes over.
  }
}
