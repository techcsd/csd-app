import { inject, Injectable, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Capacitor } from '@capacitor/core';
import { ToastService } from './toast.service';
import { NavGuardService } from './nav-guard.service';
import { SyncService } from '../sync/sync.service';
import { ErrorReportService } from './error-report.service';
import { environment } from '../../../environments/environment';

// BU1 — el version.json vive en el bucket app-releases del proyecto del ENTORNO
// (dev tiene su propio historial/APK). Se deriva de environment.supabaseUrl; nunca
// se hardcodea el ref de prod. Una app dev jamás mira el version.json de prod.
const VERSION_URL = `${environment.supabaseUrl}/storage/v1/object/public/app-releases/version.json`;

/**
 * PWA update handling (Deployment doc §3 / AU10). Una PWA es una página web: cuando
 * el service worker trae un build nuevo lo activamos y recargamos SOLOS — nunca un
 * botón "Actualizar" (ese gate es solo de la APK nativa; ver version.service).
 *
 * AU10 — la recarga es SEGURA y sin bucle:
 *  (a) NUNCA se recarga en medio de un formulario/firma/wizard (`navGuard.formActivo`)
 *      ni con una subida del outbox en curso (`sync.syncing()`); la recarga se DIFIERE
 *      hasta que el usuario esté en una pantalla segura (al cerrar el form, al volver la
 *      PWA al frente, o por un watcher de respaldo).
 *  (b) NUNCA descarta datos: el outbox vive en IndexedDB y sobrevive a la recarga; Dexie
 *      corre sus upgrades preservando lo pendiente, así que una "actualización normal" es
 *      silenciosa y sin pérdida. (El único caso que ameritaría aviso sería un cambio de
 *      esquema destructivo, que Dexie maneja en su propia rutina de upgrade.)
 *  (c) Anti-bucle: sólo se aplica una recarga por pestaña dentro de una ventana corta.
 *
 * Inert en dev (SW deshabilitado) y en nativo (las updates de la APK son aparte).
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private swUpdate = inject(SwUpdate);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private sync = inject(SyncService);
  private router = inject(Router);
  private errorReport = inject(ErrorReportService);

  /** Hay un build nuevo activado esperando una recarga segura. */
  private pendingReload = false;
  /** Watcher de respaldo mientras la recarga está diferida. */
  private reloadTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly RELOAD_GUARD_KEY = 'sw-reloaded-at';
  /** CO1 — segundo candado, más largo, exclusivo de la auto-reparación (distinto
   *  del de la recarga normal: una reparación es más cara y no debe repetirse en
   *  bucle si el SW sigue roto tras intentarlo). */
  private static readonly REPAIR_GUARD_KEY = 'sw-repaired-at';
  private static readonly REPAIR_GUARD_WINDOW_MS = 60_000;

  /** CO1 — cuántas instalaciones de versión fallaron esta sesión (sin recargar). */
  private installFailures = 0;

  /** CO1 — true cuando el SW quedó en un estado degradado (falló repetido o
   *  `unrecoverable`): Perfil/«Reparar la app» y `check()` lo usan para ofrecer
   *  reparar en vez de mentir "ya tienes la última versión". */
  necesitaReparar = signal(false);

  init(): void {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((evt) => {
        if (evt.type === 'VERSION_READY') {
          void this.applyUpdate();
        } else if (evt.type === 'VERSION_INSTALLATION_FAILED') {
          this.installFailures++;
          void this.errorReport.report('sync', `sw_update: instalación falló (${this.installFailures}ª vez)`, {
            sw_event: 'VERSION_INSTALLATION_FAILED',
            error: evt.error,
            intento: this.installFailures,
          });
          // CO1 — 2 fallas de instalación en la misma sesión → el SW está atascado;
          // auto-reparar en vez de dejar al usuario congelado para siempre.
          if (this.installFailures >= 2) void this.autoRepair('instalacion_fallida_repetida');
        }
      });

      this.swUpdate.unrecoverable.subscribe((evt) => {
        void this.errorReport.report('sync', `sw_update: unrecoverable — ${evt.reason}`, {
          sw_event: 'unrecoverable',
          reason: evt.reason,
        });
        void this.autoRepair('unrecoverable');
      });

      // AP8/AU10 — iOS/Safari PWA no chequea el SW de forma fiable (suspende la pestaña).
      // Chequeamos ACTIVAMENTE al arrancar y cada vez que la PWA vuelve al frente, para
      // que un cambio publicado se tome solo (antes se quedaban en un build viejo — el
      // que aún mostraba el prompt de actualizar y reportaba versión vieja en AS3).
      void this.pull();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        // Si había una recarga diferida, intentarla ahora que volvió el usuario; si no,
        // buscar una versión nueva.
        if (this.pendingReload) this.tryReload();
        else void this.pull();
      });

      // Al terminar cada navegación (p. ej. el chofer cerró el wizard) reintentamos la
      // recarga diferida: ya no hay formulario activo → es un buen momento seguro.
      this.router.events.subscribe((e) => {
        if (e instanceof NavigationEnd && this.pendingReload) this.tryReload();
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

  /** VERSION_READY: activar el build nuevo y programar una recarga segura. */
  private async applyUpdate(): Promise<void> {
    try {
      await this.swUpdate.activateUpdate();
    } catch {
      /* ya activo o SW no listo — la recarga igual traerá el build nuevo */
    }
    this.pendingReload = true;
    this.tryReload();
    // Respaldo: si ahora es inseguro (form/subida), reintentar hasta que se pueda.
    if (this.pendingReload && !this.reloadTimer) {
      this.reloadTimer = setInterval(() => this.tryReload(), 3000);
    }
  }

  /** Recarga si es seguro; si no, se queda diferida (la reintentan los watchers). */
  private tryReload(): void {
    if (!this.pendingReload) return;
    // (a) No interrumpir un formulario/firma/wizard ni una subida del outbox en curso.
    if (this.navGuard.formActivo || this.sync.syncing()) return;

    // (c) Anti-bucle: no repetir una recarga si ya hicimos una hace muy poco.
    const last = Number(sessionStorage.getItem(UpdateService.RELOAD_GUARD_KEY) || 0);
    if (last && Date.now() - last < 10_000) {
      this.finishReloadWatcher();
      return;
    }

    this.pendingReload = false;
    this.finishReloadWatcher();
    sessionStorage.setItem(UpdateService.RELOAD_GUARD_KEY, String(Date.now()));
    this.toast.show('Actualizando a la última versión…', 'info', 1500);
    setTimeout(() => document.location.reload(), 800);
  }

  private finishReloadWatcher(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer);
      this.reloadTimer = null;
    }
  }

  /**
   * CO1 — auto-reparación: el service worker quedó en un estado del que nunca
   * sale solo (instalación fallida repetida / `unrecoverable`). Se desregistra el
   * SW y se borran las cachés de `caches` (los assets: se vuelven a bajar solos),
   * **nunca IndexedDB** (ahí vive el outbox — Dexie no se toca). Respeta el mismo
   * candado anti-formulario que una recarga normal, y un candado propio más largo
   * para no repetir la reparación en bucle si el SW sigue roto.
   */
  private async autoRepair(motivo: string): Promise<void> {
    const last = Number(sessionStorage.getItem(UpdateService.REPAIR_GUARD_KEY) || 0);
    if (last && Date.now() - last < UpdateService.REPAIR_GUARD_WINDOW_MS) return;
    sessionStorage.setItem(UpdateService.REPAIR_GUARD_KEY, String(Date.now()));
    this.necesitaReparar.set(true);
    void this.errorReport.report('sync', `sw_update: auto-reparando (${motivo})`, { sw_motivo: motivo });

    // No interrumpir un formulario/firma en curso: se reintenta cuando sea seguro,
    // igual que una recarga normal diferida.
    if (this.navGuard.formActivo || this.sync.syncing()) {
      this.pendingReload = true;
      if (!this.reloadTimer) this.reloadTimer = setInterval(() => this.tryReload(), 3000);
      return;
    }
    await this.reparar();
  }

  /**
   * CO1 — "Reparar la app" (Perfil › Acerca de, y `/actualizar` en PWA). Misma
   * rutina que la auto-reparación, pero invocable a mano y sin esperar el candado
   * de 60s (el usuario decidió tocarla). Nunca borra el outbox (IndexedDB/Dexie).
   */
  async reparar(): Promise<void> {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      if (regs) await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      /* best-effort */
    }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {
      /* best-effort */
    }
    this.necesitaReparar.set(false);
    this.toast.show('Reparando la app…', 'info', 1500);
    setTimeout(() => document.location.reload(), 800);
  }

  /** Compares the published versionName to the installed one (native APK). */
  private async checkAppVersion(): Promise<void> {
    try {
      const res = await fetch(VERSION_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const info = (await res.json()) as { versionName: string; entorno?: string };
      // BU1 F2.4 — solo aceptamos el version.json de NUESTRO propio entorno: una app
      // prod jamás ofrece instalar un APK dev y viceversa (el bucket es por proyecto,
      // pero esto lo blinda por si alguien apunta mal la URL).
      if (info.entorno && info.entorno !== environment.entorno) return;
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

  /** Manual "Buscar actualización" from Perfil / pantalla /actualizar en PWA. */
  async check(): Promise<void> {
    if (!this.swUpdate.isEnabled) {
      this.toast.success('Ya tienes la última versión.');
      return;
    }
    // CO1 — si el SW ya quedó marcado como degradado, no hay nada que "buscar":
    // decirlo tal cual y dejar que el usuario repare.
    if (this.necesitaReparar()) {
      this.toast.error('La app no pudo actualizarse sola. Toca "Reparar la app".');
      return;
    }
    const found = await this.swUpdate.checkForUpdate();
    if (!found) this.toast.success('Ya tienes la última versión.');
    // If found, the VERSION_READY handler above takes over (activa + recarga seguro).
  }
}
