import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Geolocation, type Position } from '@capacitor/geolocation';
import { LocalStore } from './local-store.service';

/** Native bridge to AppSettingsPlugin (android/.../AppSettingsPlugin.java). */
interface AppSettingsPlugin {
  open(): Promise<void>;
}
const AppSettings = registerPlugin<AppSettingsPlugin>('AppSettings');

export type PermState = 'granted' | 'denied' | 'prompt' | 'unavailable';

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

  constructor(private store: LocalStore) {}

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
  }): Promise<
    | { ok: true; lat: number; lng: number }
    | { ok: false; reason: 'denied' | 'denied-permanent' | 'timeout' | 'unavailable' }
  > {
    let state = await this.checkLocation();
    if (state === 'prompt') state = await this.requestLocation();

    if (state === 'denied') {
      // Si ya lo habíamos pedido antes, casi seguro es "denegado permanente".
      const askedBefore = await this.locationAsked();
      return { ok: false, reason: askedBefore ? 'denied-permanent' : 'denied' };
    }
    if (state === 'unavailable') return { ok: false, reason: 'unavailable' };

    try {
      const pos: Position = await Geolocation.getCurrentPosition({
        enableHighAccuracy: opts?.highAccuracy ?? true,
        timeout: opts?.timeout ?? 10000,
      });
      return { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch (e) {
      const msg = (e as Error)?.message?.toLowerCase() ?? '';
      if (msg.includes('denied') || msg.includes('permission')) {
        return { ok: false, reason: 'denied-permanent' };
      }
      if (msg.includes('timeout') || msg.includes('time out')) {
        return { ok: false, reason: 'timeout' };
      }
      return { ok: false, reason: 'unavailable' };
    }
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
      return 'granted';
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError') return 'unavailable';
      return 'denied';
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
