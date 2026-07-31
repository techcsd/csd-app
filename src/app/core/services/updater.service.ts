import { inject, Injectable, signal } from '@angular/core';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
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
 * installer (ApkInstaller → ACTION_VIEW). On the PWA: reload to pick up the new
 * service-worker build. Every failure is surfaced (no silent dead-ends).
 *
 * "Sin tanta vuelta": the APK is downloaded ONCE and cached; if Android still
 * needs the one-time "instalar apps desconocidas" permission, we deep-link to
 * that setting and RESUME the install automatically when the user comes back —
 * no re-download, no second tap. The unknown-source grant is per-app, so it is
 * only ever asked the first time; later updates go straight to the installer.
 */
@Injectable({ providedIn: 'root' })
export class UpdaterService {
  private version = inject(VersionService);
  private toast = inject(ToastService);

  readonly esNativo = Capacitor.isNativePlatform();
  readonly estado = signal<EstadoActualizacion>('idle');
  readonly progreso = signal(0); // 0..100 while downloading

  /** APK already downloaded this session (reused after a permission trip). */
  private apkUri: string | null = null;
  /** 'resume' listener that auto-continues the install after the settings trip. */
  private resumeHandle?: PluginListenerHandle;

  /** Kick off the update. Returns false when there's nothing to install. */
  async actualizar(): Promise<boolean> {
    // APP-022: en la PWA/web NO se descarga un APK (inservible en web). La versión
    // nueva del bundle se toma al recargar (el service worker activa el build nuevo).
    if (!this.esNativo) {
      this.toast.show('Actualizando la app web…', 'info', 2000);
      setTimeout(() => document.location.reload(), 800);
      return true;
    }
    const url = this.version.apkUrl;
    if (!url) {
      this.toast.error('Aún no hay un archivo de instalación disponible. Inténtalo más tarde.');
      return false;
    }
    // Reutiliza el APK ya descargado (p. ej. tras ir a activar el permiso): no
    // vuelve a bajar 8 MB, va directo a instalar.
    if (!this.apkUri && !(await this.descargar(url))) return false;
    return this.instalar();
  }

  /** Abre los ajustes de "instalar apps desconocidas" para esta app. */
  async abrirAjustesPermiso(): Promise<void> {
    try {
      await ApkInstaller.openInstallSettings();
    } catch {
      /* best effort */
    }
  }

  /** Descarga el APK a caché con progreso; guarda la ruta local en apkUri. */
  private async descargar(url: string): Promise<boolean> {
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
      await Filesystem.downloadFile({ url, path: fileName, directory: Directory.Cache, progress: true });
      this.progreso.set(100);
      const { uri } = await Filesystem.getUri({ directory: Directory.Cache, path: fileName });
      this.apkUri = uri;
      return true;
    } catch (e) {
      console.error('UpdaterService.descargar failed:', e);
      this.estado.set('error');
      this.toast.error('No se pudo descargar la actualización. Revisa tu conexión e inténtalo de nuevo.');
      return false;
    } finally {
      await handle?.remove();
    }
  }

  /** Entrega el APK cacheado al instalador del sistema (o guía el permiso). */
  private async instalar(): Promise<boolean> {
    if (!this.apkUri) return false;
    this.estado.set('instalando');
    try {
      const res = await ApkInstaller.install({ path: this.apkUri });
      if (res.needsPermission) {
        // Falta el permiso de "apps desconocidas": lo pedimos UNA vez, abrimos el
        // ajuste directo y reanudamos la instalación solos cuando el usuario vuelve.
        this.estado.set('permiso');
        await this.armarReanudacion();
        this.toast.show(
          'Activa "Instalar apps desconocidas" para CSD App. Al volver, la instalación sigue sola.',
          'info',
          6000,
        );
        return false;
      }
      // El instalador del sistema tomó el control; su UI continúa el proceso.
      this.estado.set('idle');
      return true;
    } catch (e) {
      console.error('UpdaterService.instalar failed:', e);
      this.estado.set('error');
      this.toast.error('No se pudo abrir el instalador. Inténtalo de nuevo.');
      return false;
    }
  }

  /**
   * Abre el ajuste del permiso y deja armado un listener de 'resume': cuando el
   * usuario regresa con el permiso concedido, la instalación continúa sin que
   * tenga que volver a tocar nada ni re-descargar.
   */
  private async armarReanudacion(): Promise<void> {
    await this.abrirAjustesPermiso();
    if (this.resumeHandle) return;
    this.resumeHandle = await App.addListener('resume', async () => {
      if (this.estado() !== 'permiso' || !this.apkUri) return;
      const { granted } = await ApkInstaller.canInstall();
      if (!granted) return; // sigue sin permiso: esperamos el próximo regreso
      await this.limpiarReanudacion();
      await this.instalar();
    });
  }

  private async limpiarReanudacion(): Promise<void> {
    await this.resumeHandle?.remove();
    this.resumeHandle = undefined;
  }
}
