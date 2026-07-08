import { inject, Injectable } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { ToastService } from './toast.service';

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
    if (!this.swUpdate.isEnabled) return;
    this.swUpdate.versionUpdates.subscribe((evt) => {
      if (evt.type === 'VERSION_READY') {
        this.toast.show('Hay una versión nueva. Actualizando…', 'info', 2500);
        void this.swUpdate.activateUpdate().then(() => {
          setTimeout(() => document.location.reload(), 1500);
        });
      }
    });
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
