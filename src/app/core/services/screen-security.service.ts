import { Injectable } from '@angular/core';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** Native bridge to ScreenSecurityPlugin (android/.../ScreenSecurityPlugin.java). */
interface ScreenSecurityPlugin {
  enable(): Promise<void>;
  disable(): Promise<void>;
}
const ScreenSecurity = registerPlugin<ScreenSecurityPlugin>('ScreenSecurity');

/**
 * CZ7/DZ-19 — "Pantalla protegida" mientras hay secretos del Vault a la vista.
 * Android: FLAG_SECURE nativo (bloquea capturas/grabación Y la miniatura del
 * selector de apps recientes) — SOLO mientras una pantalla del Vault está
 * activa; se apaga al salir para no afectar el resto de la app (p. ej. el
 * diagnóstico por screenshot de 'sistema' en Pendientes, BM1).
 *
 * iOS/PWA: no existe un FLAG_SECURE equivalente — el VaultSessionService +
 * las pantallas del Vault cubren ese caso con el blur-en-background (best
 * effort, documentado en DZ-19) en vez de este plugin.
 */
@Injectable({ providedIn: 'root' })
export class ScreenSecurityService {
  private activa = false;

  async enable(): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.activa) return;
    this.activa = true;
    try {
      await ScreenSecurity.enable();
    } catch {
      /* best-effort: nunca romper la pantalla por esto */
    }
  }

  async disable(): Promise<void> {
    if (!Capacitor.isNativePlatform() || !this.activa) return;
    this.activa = false;
    try {
      await ScreenSecurity.disable();
    } catch {
      /* best-effort */
    }
  }
}
