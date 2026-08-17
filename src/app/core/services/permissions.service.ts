import { Injectable, inject } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { Camera } from '@capacitor/camera';
import { LocalStore } from './local-store.service';
import { ErrorReportService } from './error-report.service';

/** Native bridge to AppSettingsPlugin (android/.../AppSettingsPlugin.java). */
interface AppSettingsPlugin {
  open(): Promise<void>;
  // AS1 — exclusión real de la optimización de batería (tracking en background).
  isIgnoringBatteryOptimizations(): Promise<{ value: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ alreadyIgnoring: boolean }>;
}
const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

export type PermState = 'granted' | 'denied' | 'prompt' | 'unavailable';

/** X4 — permisos que la app puede necesitar, con un contrato uniforme. */
export type PermTipo = 'location' | 'camera' | 'mic' | 'notifications';

/**
 * P1/P2 — punto único para permisos de dispositivo (ubicación y micrófono).
 * Centraliza chequear/pedir permiso, obtener posición con errores clasificados,
 * y abrir los ajustes de la app cuando el permiso quedó "denegado permanente".
 *
 * - Ubicación: usa @capacitor/geolocation (nativo) o la Geolocation API del
 *   navegador en la PWA.
 * - Micrófono: no hay plugin nativo; el permiso lo concede el WebView al llamar
 *   getUserMedia. Aquí solo lo probamos/clasificamos para dar mensajes claros.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsService {
  private native = Capacitor.isNativePlatform();

  // Recordamos si ya pedimos ubicación una vez en el onboarding, para distinguir
  // "primera vez" (prompt) de "el usuario ya la negó antes" (ofrecer ajustes).
  private readonly LOC_ASKED_KEY = 'csd_perm_location_asked';
  // PWA: la Permissions API no soporta 'camera'/'microphone' en Safari/iOS, así
  // que check() devolvería 'prompt' SIEMPRE → la tarjeta saldría en cada foto/nota.
  // Recordamos localmente que ya se concedió una vez (best-effort) para no repetir.
  private readonly CAM_OK_KEY = 'csd_perm_camera_granted';
  private readonly MIC_OK_KEY = 'csd_perm_mic_granted';

  private errors = inject(ErrorReportService);

  constructor(private store: LocalStore) {}

  // ---- API unificada (X4) -----------------------------------------------

  /** Estado actual del permiso `tipo` sin abrir ningún diálogo. */
  check(tipo: PermTipo): Promise<PermState> {
    switch (tipo) {
      case 'location':
        return this.checkLocation();
      case 'camera':
        return this.checkCamera();
      case 'mic':
        return this.checkMic();
      case 'notifications':
        return this.checkNotifications();
    }
  }

  /** Pide el permiso `tipo` (dispara el diálogo del SO/WebView si aplica). */
  request(tipo: PermTipo): Promise<PermState> {
    switch (tipo) {
      case 'location':
        return this.requestLocation();
      case 'camera':
        return this.requestCamera();
      case 'mic':
        return this.requestMic();
      case 'notifications':
        return this.requestNotifications();
    }
  }

  // ---- Ubicación --------------------------------------------------------

  /** Estado actual del permiso de ubicación (sin abrir diálogo). */
  async checkLocation(): Promise<PermState> {
    try {
      if (this.native) {
        const p = await Geolocation.checkPermissions();
        return this.mapGeo(p.location);
      }
      // PWA: Permissions API (no en todos los navegadores iOS).
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      if (!perms?.query) return 'prompt';
      const st = await perms.query({ name: 'geolocation' as PermissionName });
      return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  /** Pide el permiso de ubicación (abre el diálogo del SO si aplica). */
  async requestLocation(): Promise<PermState> {
    await this.store.set(this.LOC_ASKED_KEY, '1');
    try {
      if (this.native) {
        const p = await Geolocation.requestPermissions({ permissions: ['location'] });
        return this.mapGeo(p.location);
      }
      // En la PWA el diálogo lo dispara getCurrentPosition; devolvemos prompt.
      return await this.checkLocation();
    } catch {
      return 'unavailable';
    }
  }

  /** ¿Ya se pidió el permiso de ubicación alguna vez (onboarding)? */
  async locationAsked(): Promise<boolean> {
    return (await this.store.get(this.LOC_ASKED_KEY)) === '1';
  }

  /**
   * Obtiene la posición actual, pidiendo permiso si hace falta. Devuelve la
   * posición o un objeto de error clasificado para que la UI decida el mensaje
   * y si ofrece abrir ajustes.
   */
  async getPosition(opts?: {
    highAccuracy?: boolean;
    timeout?: number;
    maximumAge?: number;
  }): Promise<
    | { ok: true; lat: number; lng: number }
    | { ok: false; reason: 'denied' | 'denied-permanent' | 'timeout' | 'gps-off' | 'unavailable' }
  > {
    let state = await this.checkLocation();
    if (state === 'prompt') state = await this.requestLocation();

    if (state === 'denied') {
      // Si ya lo habíamos pedido antes, casi seguro es "denegado permanente".
      const askedBefore = await this.locationAsked();
      return { ok: false, reason: askedBefore ? 'denied-permanent' : 'denied' };
    }
    if (state === 'unavailable') return { ok: false, reason: 'unavailable' };

    // S28 — en Android/MIUI `getCurrentPosition` a veces NO resuelve nunca o
    // devuelve "location unavailable" aunque el permiso esté dado (issues
    // ionic-team/capacitor #683, #4962). Estrategia robusta:
    //  1) aceptar un fix reciente (maximumAge) → instantáneo si ya hay uno;
    //  2) correr getCurrentPosition Y watchPosition en paralelo y quedarnos con
    //     el primero (watchPosition suele entregar el primer fix cuando
    //     getCurrentPosition se cuelga);
    //  3) timeout amplio (25s) para la adquisición en frío.
    const enableHighAccuracy = opts?.highAccuracy ?? true;
    const timeout = opts?.timeout ?? 25000;
    const maximumAge = opts?.maximumAge ?? 60000;
    try {
      const pos = await this.acquireFirstFix({ enableHighAccuracy, timeout, maximumAge });
      return { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      const reason = this.classifyPosError(e);
      // Y6 — telemetría explícita del fallo de adquisición GPS (mismo pipeline
      // outbox/sanitizado/anti-loop). No reporta 'denied' (sale antes) sino los
      // fallos reales de fix: timeout, gps-off, unavailable.
      void this.errors.report('gps', e instanceof Error ? e.message : String(e), {
        reason,
        native: this.native,
        high_accuracy: enableHighAccuracy,
        timeout,
      });
      return { ok: false, reason };
    }
  }

  /**
   * S28 — obtiene el primer fix disponible corriendo getCurrentPosition +
   * watchPosition en paralelo; resuelve con el que llegue primero y limpia el
   * watch. Rechaza al agotar el timeout global (con la última causa vista).
   */
  private acquireFirstFix(o: { enableHighAccuracy: boolean; timeout: number; maximumAge: number }): Promise<Position> {
    return new Promise<Position>((resolve, reject) => {
      let settled = false;
      let watchId: string | null = null;
      let lastErr: unknown = new Error('timeout');
      const cleanup = () => {
        clearTimeout(timer);
        if (watchId != null) {
          void Geolocation.clearWatch({ id: watchId });
          watchId = null;
        }
      };
      const done = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        fn();
      };
      const timer = setTimeout(() => done(() => reject(lastErr)), o.timeout);

      // 1) getCurrentPosition (rápido si hay un fix reciente vía maximumAge).
      Geolocation.getCurrentPosition(o)
        .then((pos) => done(() => resolve(pos)))
        .catch((e) => (lastErr = e)); // no rechazamos: dejamos que watchPosition intente

      // 2) watchPosition — más fiable en Android cuando getCurrentPosition se cuelga.
      Geolocation.watchPosition(o, (pos, err) => {
        if (err) {
          lastErr = err;
          return;
        }
        if (pos) done(() => resolve(pos));
      })
        .then((id) => {
          if (settled) void Geolocation.clearWatch({ id });
          else watchId = id;
        })
        .catch((e) => (lastErr = e));
    });
  }

  /** S28 — clasifica el error de posición para el mensaje de la UI. */
  private classifyPosError(e: unknown): 'denied-permanent' | 'timeout' | 'gps-off' | 'unavailable' {
    const msg = ((e as Error)?.message ?? '').toLowerCase();
    if (msg.includes('denied') || msg.includes('permission')) return 'denied-permanent';
    // GPS del sistema apagado (distinto de "sin señal"): el usuario debe activarlo.
    if (msg.includes('disabled') || msg.includes('location services') || msg.includes('location unavailable')) {
      return 'gps-off';
    }
    if (msg.includes('timeout') || msg.includes('time out')) return 'timeout';
    return 'unavailable';
  }

  // ---- Micrófono --------------------------------------------------------

  /**
   * Solicita/comprueba el micrófono abriendo un stream de audio efímero.
   * Es la única forma de disparar el permiso del WebView sin plugin nativo.
   * Devuelve el estado; el stream se libera de inmediato.
   */
  async requestMic(): Promise<PermState> {
    if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await this.store.set(this.MIC_OK_KEY, '1');
      return 'granted';
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError') return 'unavailable';
      return 'denied';
    }
  }

  // ---- Cámara (X4) ------------------------------------------------------

  /** Estado del permiso de cámara (nativo vía Capacitor; PWA vía Permissions API). */
  async checkCamera(): Promise<PermState> {
    try {
      if (this.native) {
        const p = await Camera.checkPermissions();
        return this.mapGeo(p.camera);
      }
      const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
      if (perms?.query) {
        try {
          const st = await perms.query({ name: 'camera' as PermissionName });
          return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
        } catch {
          /* Safari/Firefox no soportan 'camera' en Permissions API */
        }
      }
      // Sin Permissions API fiable: si ya se concedió antes, no repetimos la tarjeta.
      return (await this.store.get(this.CAM_OK_KEY)) === '1' ? 'granted' : 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  /** Pide el permiso de cámara. En PWA lo dispara un getUserMedia efímero. */
  async requestCamera(): Promise<PermState> {
    try {
      if (this.native) {
        const p = await Camera.requestPermissions({ permissions: ['camera'] });
        return this.mapGeo(p.camera);
      }
      if (!navigator.mediaDevices?.getUserMedia) return 'unavailable';
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      await this.store.set(this.CAM_OK_KEY, '1');
      return 'granted';
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError') return 'unavailable';
      return 'unavailable';
    }
  }

  // ---- Micrófono: estado (el request vive más abajo) --------------------

  /** Estado del micrófono (Permissions API; no siempre disponible en iOS/Safari). */
  async checkMic(): Promise<PermState> {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (perms?.query) {
      try {
        const st = await perms.query({ name: 'microphone' as PermissionName });
        return st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
      } catch {
        /* no soportado → cae al flag recordado */
      }
    }
    return (await this.store.get(this.MIC_OK_KEY)) === '1' ? 'granted' : 'prompt';
  }

  // ---- Notificaciones (X4) ----------------------------------------------
  // Solo Web Notifications API (PWA). En el WebView nativo no hay plugin de push
  // instalado → 'unavailable' (el gate degrada en silencio). Punto de enganche
  // para cuando se añada @capacitor/push-notifications.

  async checkNotifications(): Promise<PermState> {
    if (typeof Notification === 'undefined') return 'unavailable';
    const p = Notification.permission;
    return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
  }

  async requestNotifications(): Promise<PermState> {
    if (typeof Notification === 'undefined') return 'unavailable';
    try {
      const r = await Notification.requestPermission();
      return r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  // ---- Ajustes de la app ------------------------------------------------

  /** Abre los ajustes de la app (Android) para activar un permiso a mano. */
  async openAppSettings(): Promise<boolean> {
    if (!this.native) return false;
    try {
      await AppSettings.open();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * AS1 — ¿la app está excluida de la optimización de batería? (En no-nativo o si
   * falla el bridge devolvemos true para no molestar con avisos que no aplican.)
   */
  async isIgnoringBattery(): Promise<boolean> {
    if (!this.native) return true;
    try {
      return (await AppSettings.isIgnoringBatteryOptimizations()).value;
    } catch {
      return true;
    }
  }

  /** AS1 — dispara el diálogo nativo de exclusión de optimización de batería. */
  async requestIgnoreBattery(): Promise<void> {
    if (!this.native) return;
    try {
      await AppSettings.requestIgnoreBatteryOptimizations();
    } catch {
      /* best-effort: si falla, el usuario puede hacerlo desde Ajustes */
    }
  }

  get isNative(): boolean {
    return this.native;
  }

  private mapGeo(state: string): PermState {
    switch (state) {
      case 'granted':
        return 'granted';
      case 'denied':
        return 'denied';
      case 'prompt':
      case 'prompt-with-rationale':
        return 'prompt';
      default:
        return 'unavailable';
    }
  }
}
