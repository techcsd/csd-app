import { inject, Injectable, signal } from '@angular/core';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { VersionService } from './version.service';
import { ToastService } from './toast.service';

/** Native bridge to ApkInstallerPlugin (android/.../ApkInstallerPlugin.java). */
interface ApkInstallerPlugin {
  canInstall(): Promise<{ granted: boolean }>;
  openInstallSettings(): Promise<void>;
  install(options: { path: string }): Promise<{ needsPermission: boolean }>;
}
const ApkInstaller = registerPlugin<ApkInstallerPlugin>('ApkInstaller');

export type EstadoActualizacion = 'idle' | 'descargando' | 'instalando' | 'permiso' | 'error';

/**
 * V3 — rolling update from inside the app. On Android: download the published
 * APK (apk_url) to cache with live progress, then hand it to the system
 * installer (ApkInstaller → ACTION_VIEW). On the PWA: open the direct download
 * link. Every failure is surfaced (no silent dead-ends).
 */
@Injectable({ providedIn: 'root' })
export class UpdaterService {
  private version = inject(VersionService);
  private toast = inject(ToastService);

  readonly esNativo = Capacitor.isNativePlatform();
  readonly estado = signal<EstadoActualizacion>('idle');
  readonly progreso = signal(0); // 0..100 while downloading

  /** Kick off the update. Returns false when there's nothing to install. */
  async actualizar(): Promise<boolean> {
    const url = this.version.apkUrl;
    if (!url) {
      this.toast.error('Aún no hay un archivo de instalación disponible. Inténtalo más tarde.');
      return false;
    }
    if (!this.esNativo) {
      // PWA / desktop: hand off to the browser's downloader.
      window.open(url, '_blank');
      return true;
    }
    return this.descargarEInstalar(url);
  }

  /** Re-try the install step after the user grants "install unknown apps". */
  async abrirAjustesPermiso(): Promise<void> {
    try {
      await ApkInstaller.openInstallSettings();
    } catch {
      /* best effort */
    }
  }

  private async descargarEInstalar(url: string): Promise<boolean> {
    this.estado.set('descargando');
    this.progreso.set(0);
    let handle: PluginListenerHandle | undefined;
    const fileName = `csd-update-${(this.version.etiquetaVersion || 'latest').replace(/[^\w.-]/g, '')}.apk`;
    try {
      handle = await Filesystem.addListener('progress', (p) => {
        if (p.contentLength > 0) {
          this.progreso.set(Math.min(100, Math.round((p.bytes / p.contentLength) * 100)));
        }
      });
      await Filesystem.downloadFile({
        url,
        path: fileName,
        directory: Directory.Cache,
        progress: true,
      });
      this.progreso.set(100);

      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
      this.estado.set('instalando');
      const res = await ApkInstaller.install({ path: uri });
      if (res.needsPermission) {
        this.estado.set('permiso');
        this.toast.show(
          'Activa "Instalar apps desconocidas" para CSD App y vuelve a tocar Actualizar.',
          'info',
          6000,
        );
        return false;
      }
      // System installer took over; leave estado at 'instalando' until the OS UI.
      this.estado.set('idle');
      return true;
    } catch (e) {
      console.error('UpdaterService.descargarEInstalar failed:', e);
      this.estado.set('error');
      this.toast.error('No se pudo descargar la actualización. Revisa tu conexión e inténtalo de nuevo.');
      return false;
    } finally {
      await handle?.remove();
    }
  }
}
