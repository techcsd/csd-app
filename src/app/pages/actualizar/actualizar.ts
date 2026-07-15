import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { VersionService } from '../../core/services/version.service';
import { UpdaterService } from '../../core/services/updater.service';

/**
 * V3/V4 — "Nueva versión disponible" screen. Reached from the update banner,
 * the version-check button (V2), and (V4) the in-app new-version notification.
 * Native: downloads the APK with a progress bar and launches the installer.
 * PWA: offers the direct download link.
 */
@Component({
  selector: 'app-actualizar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './actualizar.html',
  styleUrl: './actualizar.scss',
})
export class ActualizarPage {
  private versionSvc = inject(VersionService);
  private updater = inject(UpdaterService);
  private location = inject(Location);

  esNativo = this.updater.esNativo;
  estado = this.updater.estado;
  progreso = this.updater.progreso;

  local = this.versionSvc.local;
  nueva = computed(() => this.versionSvc.etiquetaVersion);
  hayNueva = () => this.versionSvc.hayNueva();
  notas = () => this.versionSvc.notas;
  apkUrl = () => this.versionSvc.apkUrl;

  iniciado = signal(false);

  async actualizar(): Promise<void> {
    this.iniciado.set(true);
    await this.updater.actualizar();
  }

  abrirAjustes(): void {
    void this.updater.abrirAjustesPermiso();
  }

  volver(): void {
    this.location.back();
  }
}
