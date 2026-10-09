import { inject, Injectable, signal } from '@angular/core';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { AppUpdate } from '@capawesome/capacitor-app-update';
import { environment } from '../../../environments/environment';
import { VersionService } from './version.service';
import { TiendasService } from './tiendas.service';
import { ToastService } from './toast.service';
import { ErrorReportService } from './error-report.service';
import { abrirUrlExterna } from '../utils/abrir-url.util';

type Canal = 'play' | 'apk' | 'appstore' | 'pwa';

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
  private tiendas = inject(TiendasService);
  private toast = inject(ToastService);
  private errores = inject(ErrorReportService);

  readonly esNativo = Capacitor.isNativePlatform();
  // CL4 — fallback defensivo: si un binario nativo se construyó mal con canal 'pwa'
  // (el bug que arreglamos), `actualizar()` solo recargaría la web en vez de instalar.
  // Lo tratamos como Android→'apk' / iOS→'appstore' y dejamos telemetría.
  readonly canal: Canal = this.resolverCanal();

  private resolverCanal(): Canal {
    const c = environment.canal as Canal;
    if (this.esNativo && c === 'pwa') {
      const fallback: Canal = Capacitor.getPlatform() === 'ios' ? 'appstore' : 'apk';
      void this.errores.report('info', `canal_incoherente: binario nativo con canal 'pwa' → ${fallback}`, {
        canal_env: c,
        plataforma: Capacitor.getPlatform(),
        fallback,
      });
      return fallback;
    }
    return c;
  }
  readonly estado = signal<EstadoActualizacion>('idle');
  readonly progreso = signal(0); // 0..100 while downloading

  /** APK already downloaded this session (reused after a permission trip). */
  private apkUri: string | null = null;
  /** 'resume' listener that auto-continues the install after the settings trip. */
  private resumeHandle?: PluginListenerHandle;

  /** CI7 — Arranca la actualización POR CANAL. Returns false cuando no hay nada que hacer.
   *  · pwa → recarga (el service worker activa el build nuevo).
   *  · play → Play In-App Updates (inmediata si < mínima; flexible si hay nueva).
   *  · appstore → abre la ficha del App Store.
   *  · apk → descarga e instala el APK (teléfonos sin Google Play). */
  async actualizar(): Promise<boolean> {
    if (!this.esNativo || this.canal === 'pwa') {
      this.toast.show('Actualizando la app web…', 'info', 2000);
      setTimeout(() => document.location.reload(), 800);
      return true;
    }
    if (this.canal === 'play') return this.actualizarPlay();
    if (this.canal === 'appstore') return this.actualizarAppStore();
    return this.actualizarApk();
  }

  /** Canal apk: flujo histórico (descarga + instala vía ApkInstaller). */
  private async actualizarApk(): Promise<boolean> {
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

  /** CI7 — Canal play: Play In-App Updates. Inmediata si la instalada < mínima; si
   *  no, flexible. Si el plugin no está disponible (p. ej. QA con APK de canal play),
   *  cae a abrir la ficha de Google Play. */
  private async actualizarPlay(): Promise<boolean> {
    try {
      const info = await AppUpdate.getAppUpdateInfo();
      // 2 = UPDATE_AVAILABLE (Play Core AppUpdateAvailability).
      if (String(info.updateAvailability) !== '2') {
        this.toast.show('Ya tienes la última versión.', 'info', 2500);
        return true;
      }
      if (this.version.debeActualizar() && info.immediateUpdateAllowed) {
        await AppUpdate.performImmediateUpdate();
        return true;
      }
      if (info.flexibleUpdateAllowed) {
        await AppUpdate.startFlexibleUpdate();
        await AppUpdate.completeFlexibleUpdate();
        return true;
      }
      await AppUpdate.openAppStore();
      return true;
    } catch {
      // Plugin no disponible / "no instalada desde Play" → abre la ficha de Play.
      const url = this.tiendas.playUrl();
      if (url) {
        await abrirUrlExterna(url);
        return true;
      }
      this.toast.error('No se pudo abrir Google Play. Inténtalo más tarde.');
      return false;
    }
  }

  /** CI7 — Canal appstore (iOS): abre la ficha del App Store (iOS no permite instalar
   *  binarios desde la app). */
  private async actualizarAppStore(): Promise<boolean> {
    const url = this.tiendas.appStoreUrl();
    if (!url) {
      this.toast.error('Aún no está disponible en el App Store.');
      return false;
    }
    await abrirUrlExterna(url);
    return true;
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
