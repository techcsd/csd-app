import { Component, effect, inject } from '@angular/core';
import { I18nService } from './core/i18n/i18n.service';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { AppLauncher } from '@capacitor/app-launcher';
import { ToastHost } from './shared/components/toast-host/toast-host';
import { PermisoHost } from './shared/components/permiso-host/permiso-host';
import { AlarmaHost } from './shared/components/alarma-host/alarma-host';
import { PermisosOnboarding } from './shared/components/permisos-onboarding/permisos-onboarding';
import { LanguageOnboarding } from './shared/ui/language-onboarding/language-onboarding';
import { InAppCamera } from './shared/ui/in-app-camera/in-app-camera';
import { ConsentimientoIa } from './shared/components/consentimiento-ia/consentimiento-ia';
import { ConsentimientoUbicacion } from './shared/components/consentimiento-ubicacion/consentimiento-ubicacion';
import { AceptacionPoliticas } from './shared/components/aceptacion-politicas/aceptacion-politicas';
import { TiendaAviso } from './shared/components/tienda-aviso/tienda-aviso';
import { PoliticasService } from './core/services/politicas.service';
import { TiendasService } from './core/services/tiendas.service';
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
import { ImpersonationService } from './core/services/impersonation.service';
import { ThemeService } from './core/services/theme.service';
import { CameraService } from './core/services/camera.service';
import { IdiomaOnboardingService } from './core/i18n/idioma-onboarding.service';
import { hasSupabaseProject } from './core/services/supabase.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHost, PermisoHost, AlarmaHost, PermisosOnboarding, LanguageOnboarding, InAppCamera, ConsentimientoIa, ConsentimientoUbicacion, AceptacionPoliticas, TiendaAviso],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  // Injecting these boots the connectivity watcher + outbox drainer at startup.
  private theme = inject(ThemeService); // BE6 — aplica el tema y sincroniza con la web
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
  /** CI3 — aceptación de políticas pendientes (pantalla bloqueante en el shell). */
  private politicas = inject(PoliticasService);
  /** CI7 — URLs de tienda (Play/App Store) para actualizar por canal oficial + avisos. */
  private tiendas = inject(TiendasService);
  /** BV5/BT5 — listener de `appRestoredResult` (recupera una foto tras recrear la Activity). */
  private camera = inject(CameraService);
  /** AY7 — banner "USUARIO DE PRUEBA" en el shell (esPrueba del perfil). */
  ctx = inject(UserContextService);
  /** BB — "Entrar como": banner "Estás viendo como X" + salir. */
  imp = inject(ImpersonationService);
  /** BS4 — diálogo de primer ingreso de idioma (modal bloqueante en el shell). */
  idiomaOnboarding = inject(IdiomaOnboardingService);
  private router = inject(Router);
  private i18n = inject(I18nService);
  /** AS1 — evita re-evaluar el tracking en cada navegación (se resetea en /auth). */
  private trackingArrancado = false;
  /** CI3 — revisa las políticas pendientes una vez por sesión (se resetea en /auth). */
  private politicasRevisadas = false;

  /** BU1 F0 — sin proyecto configurado el shell muestra "Sin proyecto configurado"
   *  y NO arranca nada (no toca Supabase). Solo pasa en `ng serve` sin env:dev. */
  readonly sinProyecto = !hasSupabaseProject;
  /** BU1 F1 — cinta DEV: se pinta en dev (esquina superior, sobre todo el shell). */
  readonly entorno = environment.entorno;
  readonly esDev = environment.entorno === 'dev';
  /** Ref corto del proyecto (para la cinta y "Acerca de"). */
  readonly refCorto = (() => {
    try { return new URL(environment.supabaseUrl).hostname.split('.')[0].slice(0, 8); }
    catch { return '—'; }
  })();

  constructor() {
    // BU1 F0 — cortocircuito: sin proyecto no se instancia nada de la app real.
    if (this.sinProyecto) return;
    // BT2 — aviso de una sola vez si un idioma guardado aún no está disponible
    // (p. ej. Kreyòl "próximamente"): la app cae a español y lo explica.
    effect(() => {
      const aviso = this.i18n.avisoIdiomaDegradado();
      if (aviso) {
        this.toast.show(aviso, 'info', 5000);
        this.i18n.limpiarAvisoIdioma();
      }
    });
    void this.imp.init(); // BB — rehidrata "entrar como" + auto-salida al vencer (1h)
    void this.catalog.persistStorage();
    this.updates.init();
    this.autoLock.init();
    void this.checkVersion();
    this.initBackButton();
    this.initScrollReset();
    this.activityPing.init(); // W12 — ping de actividad (open + resume, throttled)
    this.platformReport.init(); // AP7 — reporta la plataforma del dispositivo (android|ios-pwa|web)
    void this.push.init(); // AF7 — push nativo (no-op en web/PWA)
    // CC7 — tras actualizar a una versión nueva, reintenta UNA vez los envíos atascados
    // por error de SISTEMA (los conduces de Jonathan/Guilamo se destraban solos si el
    // padre ya arregló el CHECK). Gate por versión → corre solo una vez por versión.
    void this.sync.reintentarSistemaTrasActualizar(environment.version);
    void this.checkAlarmaDominical(); // AK10 — alarma del reporte semanal (domingo)
    void this.syncAlarmaNativa(); // AL6 — arma/cancela la alarma AUTÓNOMA (app cerrada)
    // AL6 — re-evaluar al volver a primer plano (por si completó la inspección o
    // se le asignó un vehículo). Best-effort, nativo.
    if (Capacitor.isNativePlatform()) {
      this.camera.init(); // BV5/BT5 — recupera la foto si el SO recreó la Activity con la cámara abierta
      void CapApp.addListener('resume', () => {
        void this.syncAlarmaNativa();
        void this.notificaciones.iniciarRealtime(); // AM4 — reasegura el canal tras dormir
        void this.tracking.evaluarModoContinuo(); // AS1 — re-arma el tracking continuo
        this.imp.checkExpiracion(); // BB — sal de "entrar como" si venció el tope de 1h
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
      // CA1 — si el usuario no es operativo o Tecnología lo silenció, CANCELA la alarma
      // autónoma sin importar los pendientes (no debe sonar el domingo con la app cerrada).
      if (await this.notificaciones.alarmaSuprimida('alarm-weekly-inspection')) {
        await this.nativeAlarm.disable();
        return;
      }
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
      // CA1 — respeta el silencio (pref propia o silenciado por Tecnología) antes de
      // disparar la alarma del reporte semanal.
      if (await this.notificaciones.alarmaSuprimida('alarma-reporte-semanal')) return;
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
        // BS4 — diálogo de primer ingreso de idioma: se evalúa al llegar a una
        // pantalla fuera de /auth (tras login, antes del home). Idempotente: una vez
        // decidido/mostrado, no re-consulta.
        void this.idiomaOnboarding.evaluar();
        // CI3 — tras login, revisa si hay políticas por aceptar (una vez por sesión).
        if (!this.politicasRevisadas) {
          this.politicasRevisadas = true;
          void this.politicas.revisarPendientes();
          void this.tiendas.refrescar(); // CI7 — carga las URLs de tienda
        }
        // AS1 — arranca el tracking continuo una vez hay sesión (una vez por login;
        // se re-arma tras cada login porque `apagar()` en logout resetea el flag).
        if (!this.trackingArrancado) {
          this.trackingArrancado = true;
          void this.tracking.evaluarModoContinuo();
        }
      } else {
        this.trackingArrancado = false;
        this.politicasRevisadas = false;
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

  /** BB — vuelve a mi usuario (admin) y regresa al home. */
  async salirImpersonacion(): Promise<void> {
    await this.imp.salir();
    await this.router.navigate(['/home']);
  }

  irActualizar(): void {
    void this.router.navigate(['/actualizar']);
  }
}
