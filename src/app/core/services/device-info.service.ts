import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';

/**
 * Y6 — información del dispositivo para adjuntar a los reportes de error y para
 * diagnosticar fallos específicos por equipo (caso OUKITEL, Y5). En nativo usa
 * @capacitor/device; en la PWA cae al `navigator.userAgent`. Se resuelve una vez
 * y se cachea (no cambia durante la sesión).
 */
export interface AppDeviceInfo {
  /** Modelo del equipo (p. ej. "OT8000" / "iPhone14,3"). */
  model: string | null;
  /** Marca/fabricante (p. ej. "OUKITEL", "Xiaomi", "Apple"). */
  manufacturer: string | null;
  /** Versión del sistema operativo (p. ej. "13"). */
  osVersion: string | null;
  /** 'android' | 'ios' | 'web'. */
  platform: string;
  operatingSystem: string | null;
  /** Versión del Android System WebView / motor del navegador (clave para Y5). */
  webViewVersion: string | null;
  androidSDKVersion: number | null;
}

@Injectable({ providedIn: 'root' })
export class DeviceInfoService {
  private _info = signal<AppDeviceInfo | null>(null);
  /** Info del dispositivo una vez resuelta (null hasta que `ready()` completa). */
  info = this._info.asReadonly();
  private promise: Promise<AppDeviceInfo> | null = null;

  /** Resuelve (y cachea) la info del dispositivo. Nunca lanza. */
  ready(): Promise<AppDeviceInfo> {
    return (this.promise ??= this.load());
  }

  private async load(): Promise<AppDeviceInfo> {
    const fallback: AppDeviceInfo = {
      model: null,
      manufacturer: null,
      osVersion: null,
      platform: Capacitor.getPlatform(),
      operatingSystem: null,
      webViewVersion: this.webViewFromUA(),
      androidSDKVersion: null,
    };
    let info = fallback;
    try {
      const d = (await Device.getInfo()) as {
        model?: string;
        manufacturer?: string;
        osVersion?: string;
        platform?: string;
        operatingSystem?: string;
        webViewVersion?: string;
        androidSDKVersion?: number;
      };
      info = {
        model: d.model ?? null,
        manufacturer: d.manufacturer ?? null,
        osVersion: d.osVersion ?? null,
        platform: d.platform ?? Capacitor.getPlatform(),
        operatingSystem: d.operatingSystem ?? null,
        webViewVersion: d.webViewVersion ?? fallback.webViewVersion,
        androidSDKVersion: d.androidSDKVersion ?? null,
      };
    } catch {
      /* best-effort: nos quedamos con el fallback derivado del userAgent */
    }
    this._info.set(info);
    return info;
  }

  /** Número de versión MAYOR del WebView/motor (o null si no se pudo leer). */
  webViewMajor(): number | null {
    const v = this._info()?.webViewVersion ?? this.webViewFromUA();
    if (!v) return null;
    const m = /(\d+)/.exec(v);
    return m ? Number(m[1]) : null;
  }

  /** Deriva la versión de Chrome/WebView del userAgent (fallback PWA/pre-load). */
  private webViewFromUA(): string | null {
    const m = /Chrome\/(\d+[\d.]*)/.exec(navigator.userAgent);
    return m ? m[1] : null;
  }
}
