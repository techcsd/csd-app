import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { ToastHost } from './shared/components/toast-host/toast-host';
import { SyncService } from './core/sync/sync.service';
import { NetworkService } from './core/services/network.service';
import { CatalogService } from './core/sync/catalog.service';
import { UpdateService } from './core/services/update.service';
import { UpdaterService } from './core/services/updater.service';
import { AutoLockService } from './core/services/auto-lock.service';
import { VersionService } from './core/services/version.service';
import { ToastService } from './core/services/toast.service';
import { NavGuardService } from './core/services/nav-guard.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHost],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // Injecting these boots the connectivity watcher + outbox drainer at startup.
  private sync = inject(SyncService);
  private network = inject(NetworkService);
  private catalog = inject(CatalogService);
  private updates = inject(UpdateService);
  updater = inject(UpdaterService);
  private autoLock = inject(AutoLockService);
  version = inject(VersionService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private router = inject(Router);

  constructor() {
    void this.catalog.persistStorage();
    this.updates.init();
    this.autoLock.init();
    void this.checkVersion();
    this.initBackButton();
  }

  /**
   * U4 — Botón físico "Atrás" de Android. Si la página activa registró una
   * guarda de datos sin guardar y la maneja (abre "¿Descartar cambios?"), no
   * navegamos; si no, navegación normal o salir de la app en la raíz.
   */
  private initBackButton(): void {
    if (!Capacitor.isNativePlatform()) return;
    void CapApp.addListener('backButton', ({ canGoBack }) => {
      if (this.navGuard.handleBack()) return;
      if (canGoBack) window.history.back();
      else void CapApp.exitApp();
    });
  }

  private async checkVersion(): Promise<void> {
    await this.version.check();
    if (!this.version.debeActualizar() && this.version.hayNueva()) {
      this.toast.show(
        `Hay una versión nueva disponible (${this.version.info()?.version_publicada}).`,
        'info',
        6000,
      );
    }
  }

  /** Blocking gate (below-minimum): download + install in-app (V3). */
  async actualizarAhora(): Promise<void> {
    await this.updater.actualizar();
  }

  /** Non-blocking banner (V4): go to the full update flow. */
  irActualizar(): void {
    void this.router.navigate(['/actualizar']);
  }
}
