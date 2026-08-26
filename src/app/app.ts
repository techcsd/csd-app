import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { ToastHost } from './shared/components/toast-host/toast-host';
import { PermisoHost } from './shared/components/permiso-host/permiso-host';
import { AlarmaHost } from './shared/components/alarma-host/alarma-host';
import { PermisosOnboarding } from './shared/components/permisos-onboarding/permisos-onboarding';
import { InAppCamera } from './shared/ui/in-app-camera/in-app-camera';
import { SyncService } from './core/sync/sync.service';
import { NetworkService } from './core/services/network.service';
import { CatalogService } from './core/sync/catalog.service';
import { UpdateService } from './core/services/update.service';
import { UpdaterService } from './core/services/updater.service';
import { SessionService } from './core/services/session.service';
import { AutoLockService } from './core/services/auto-lock.service';
import { VersionService } from './core/services/version.service';
import { ToastService } from './core/services/toast.service';
import { NavGuardService } from './core/services/nav-guard.service';
import { ActivityPingService } from './core/services/activity-ping.service';
import { PlatformReportService } from './core/services/platform-report.service';
import { PushService } from './core/services/push.service';
import { AlarmaService } from './core/services/alarma.service';
import { NativeAlarmService } from './core/services/native-alarm.service';
import { ReporteSemanalService } from './core/services/reporte-semanal.service';
import { NotificacionesService } from './core/services/notificaciones.service';
import { DeviceInfoService } from './core/services/device-info.service';
import { TrackingService } from './core/services/tracking.service';
import { UserContextService } from './core/services/user-context.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHost, PermisoHost, AlarmaHost, PermisosOnboarding, InAppCamera],
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
  private session = inject(SessionService);
  private activityPing = inject(ActivityPingService);
  private platformReport = inject(PlatformReportService);
  private push = inject(PushService);
  private alarma = inject(AlarmaService);
  private nativeAlarm = inject(NativeAlarmService);
  private reportes = inject(ReporteSemanalService);
  private notificaciones = inject(NotificacionesService);
  private deviceInfo = inject(DeviceInfoService);
  private tracking = inject(TrackingService);
  /** AY7 — banner "USUARIO DE PRUEBA" en el shell (esPrueba del perfil). */
  ctx = inject(UserContextService);
  private router = inject(Router);
  /** AS1 — evita re-evaluar el tracking en cada navegación (se resetea en /auth). */
  private trackingArrancado = false;

  constructor() {
    void this.catalog.persistStorage();
    this.updates.init();
    this.autoLock.init();
    void this.checkVersion();
    this.initBackButton();
    this.initScrollReset();
    this.activityPing.init(); // W12 — ping de actividad (open + resume, throttled)
    this.platformReport.init(); // AP7 — reporta la plataforma del dispositivo (android|ios-pwa|web)
    void this.push.init(); // AF7 — push nativo (no-op en web/PWA)
    void this.checkAlarmaDominical(); // AK10 — alarma del reporte semanal (domingo)
    void this.syncAlarmaNativa(); // AL6 — arma/cancela la alarma AUTÓNOMA (app cerrada)
    // AL6 — re-evaluar al volver a primer plano (por si completó la inspección o
    // se le asignó un vehículo). Best-effort, nativo.
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('resume', () => {
        void this.syncAlarmaNativa();
        void this.notificaciones.iniciarRealtime(); // AM4 — reasegura el canal tras dormir
        void this.tracking.evaluarModoContinuo(); // AS1 — re-arma el tracking continuo
      });
    }
    void this.notificaciones.iniciarRealtime(); // AM4 — realtime de avisos (idempotente)
    void this.checkWebView(); // AO7 — aviso in-app si el WebView es muy viejo
  }

  /**
   * AO7 — red de seguridad en-app: el guard NATIVO (MainActivity) reemplaza la app por
   * una pantalla de "actualiza WebView" cuando detecta Chromium < 111, pero si NO pudo
   * leer la versión (devuelve -1) la app carga igual y puede verse mal. Aquí, ya dentro
   * de la app, si el motor resulta viejo mostramos un aviso accionable (Play Store). El
   * umbral iguala el piso real de Angular 21 (MIN_CHROMIUM_MAJOR = 111 en el guard nativo).
   */
  private async checkWebView(): Promise<void> {
    if (!Capacitor.isNativePlatform()) return;
    try {
      await this.deviceInfo.ready();
      const major = this.deviceInfo.webViewMajor();
      if (major != null && major > 0 && major < 111) {
        this.toast.withAction(
          `El “Android System WebView” de tu equipo (v${major}) está desactualizado y la app puede verse mal. Actualízalo desde Play Store.`,
          {
            label: 'Actualizar',
            run: () =>
              void AppLauncher.openUrl({
                url: 'market://details?id=com.google.android.webview',
              }).catch(() => {}),
          },
          'error',
          12000,
        );
      }
    } catch {
      /* best-effort: nunca romper el arranque por el chequeo del WebView */
    }
  }

  /**
   * AL6 — mantiene la alarma nativa autónoma en sync con el estado real: si el
   * usuario tiene la inspección semanal pendiente (vehículo en uso, regla server),
   * la ARMA (sonará el domingo aunque la app esté cerrada); si ya no, la CANCELA.
   * Corre en cada arranque/resume. No-op en web/PWA (iOS sin alarmas autónomas).
   */
  private async syncAlarmaNativa(): Promise<void> {
    if (!this.nativeAlarm.disponible) return;
    try {
      const pend = await this.reportes.pendientesCount();
      if (pend > 0) await this.nativeAlarm.enable();
      else await this.nativeAlarm.disable();
    } catch {
      /* sin sesión / offline: no tocar la alarma */
    }
  }

  /**
   * AK10 — al abrir la app un DOMINGO, si el usuario tiene el reporte semanal
   * pendiente, dispara la alarma tipo despertador (in-app). El sonido puede quedar
   * en espera hasta la primera interacción (política de autoplay); el overlay se ve
   * igual. La push de alta prioridad es la señal cuando la app está en primer plano.
   */
  private async checkAlarmaDominical(): Promise<void> {
    if (new Date().getDay() !== 0) return; // 0 = domingo
    try {
      const pend = await this.reportes.pendientesCount();
      if (pend > 0) {
        this.alarma.disparar({ vehiculoId: null, ruta: '/transporte/reporte-semanal' });
      }
    } catch {
      /* sin sesión / offline: no alarma */
    }
  }

  /**
   * P9 — al cambiar de ruta, toda pantalla debe abrir ARRIBA. El scroll vive en
   * los contenedores internos (.screen / .screen__body), que Angular no
   * restaura; los reseteamos a 0 tras pintar la vista nueva.
   */
  private initScrollReset(): void {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      // AM4 — asegura el canal realtime de avisos una vez hay sesión (el constructor
      // corre antes del login). Idempotente: no-op tras el primer arranque exitoso.
      if (!this.router.url.startsWith('/auth')) {
        void this.notificaciones.iniciarRealtime();
        // AS1 — arranca el tracking continuo una vez hay sesión (una vez por login;
        // se re-arma tras cada login porque `apagar()` en logout resetea el flag).
        if (!this.trackingArrancado) {
          this.trackingArrancado = true;
          void this.tracking.evaluarModoContinuo();
        }
      } else {
        this.trackingArrancado = false;
      }
      // Doble rAF: esperar a que el router-outlet monte la pantalla nueva.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          window.scrollTo(0, 0);
          document
            .querySelectorAll<HTMLElement>('.screen, .screen__body')
            .forEach((el) => (el.scrollTop = 0));
        }),
      );
    });
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
    // Y1 — red de seguridad: registra la versión instalada en el historial
    // (best-effort; solo admin/service_role la escriben, no molesta al campo).
    void this.version.autoRegistrar();
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
  /** APP-002 — escape del gate bloqueante (para no atascar al usuario si aún
   *  no hay apk_url o la descarga falla). Cierra sesión y vuelve al login. */
  async cerrarSesionGate(): Promise<void> {
    await this.session.logout();
    await this.router.navigate(['/auth/login']);
  }

  /** APP-046 — no mostrar el banner de versión sobre login/PIN. */
  enAuth(): boolean {
    return this.router.url.startsWith('/auth');
  }

  irActualizar(): void {
    void this.router.navigate(['/actualizar']);
  }
}
