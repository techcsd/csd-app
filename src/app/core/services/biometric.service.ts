import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { LocalStore } from './local-store.service';

const KEY_ENABLED = 'csd.biometric.enabled';

/**
 * Optional biometric unlock (R10) layered on top of the PIN. Huella / Face ID
 * only confirms the device owner — it never replaces the PIN, which stays the
 * always-available fallback. Not available on web (PWA), where the toggle is
 * hidden and the flow degrades to PIN-only.
 */
@Injectable({ providedIn: 'root' })
export class BiometricService {
  private store = inject(LocalStore);

  /** True only on a native device whose hardware biometry is enrolled/available. */
  async isSupported(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      const res = await BiometricAuth.checkBiometry();
      return res.isAvailable && res.biometryType !== BiometryType.none;
    } catch {
      return false;
    }
  }

  /** Whether the user has opted in to biometric unlock (persisted). */
  async isEnabled(): Promise<boolean> {
    return (await this.store.get(KEY_ENABLED)) === '1';
  }

  /** Enabled AND currently usable on this device. */
  async isActive(): Promise<boolean> {
    return (await this.isEnabled()) && (await this.isSupported());
  }

  /**
   * Turn biometric unlock on/off. Enabling first prompts for a biometric check
   * so we only store the flag once the user proves it works. Returns the final
   * enabled state.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      await this.store.set(KEY_ENABLED, '0');
      return false;
    }
    const ok = await this.authenticate('Confirma tu identidad para activar el desbloqueo biométrico');
    if (ok) {
      await this.store.set(KEY_ENABLED, '1');
      return true;
    }
    return false;
  }

  /** Prompt the native biometric dialog. Returns true only on success. */
  async authenticate(reason = 'Desbloquea la app'): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    try {
      await BiometricAuth.authenticate({
        reason,
        cancelTitle: 'Usar PIN',
        androidTitle: 'Desbloquear CSD',
        androidSubtitle: 'Usa tu huella o rostro',
      });
      return true;
    } catch {
      // Any failure (cancel, no match, lockout) → fall back to PIN silently.
      return false;
    }
  }
}
