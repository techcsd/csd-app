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
    // PWA: activate + reload when the service worker has a new build.
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((evt) => {
        if (evt.type === 'VERSION_READY') {
          this.toast.show('Hay una versión nueva. Actualizando…', 'info', 2500);
          void this.swUpdate.activateUpdate().then(() => {
            setTimeout(() => document.location.reload(), 1500);
          });
        }
      });
    }
    // Native (APK): can't self-update — check version.json and nudge the user.
    if (Capacitor.isNativePlatform()) {
      setTimeout(() => void this.checkAppVersion(), 5000);
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
