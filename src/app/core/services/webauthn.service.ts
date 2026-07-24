import { inject, Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalStore } from './local-store.service';

const KEY_CRED = 'csd.webauthn.credId';

/**
 * X8 — Desbloqueo con Face ID / Touch ID en el PWA (iPhone instalado, iOS 16.4+).
 *
 * En Android nativo el desbloqueo biométrico lo cubre BiometricService (plugin
 * nativo). En el PWA no hay plugin, así que usamos la Web Authentication API con
 * un "platform authenticator" (Face ID/Touch ID del propio dispositivo).
 *
 * OJO: aquí WebAuthn NO autentica contra un servidor — la sesión de Supabase ya
 * es la fuente de verdad de la identidad. Es una confirmación LOCAL del dueño del
 * dispositivo, exactamente como la biometría nativa, y el PIN sigue siendo el
 * fallback siempre disponible. Por eso el reto (challenge) es local y la
 * credencial se borra al cerrar sesión (SessionService.logout → clear()).
 */
@Injectable({ providedIn: 'root' })
export class WebauthnService {
  private store = inject(LocalStore);

  /** Solo PWA + autenticador de plataforma disponible (Face ID/Touch ID). */
  async isSupported(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) return false; // en nativo → BiometricService
    const PKC = (window as unknown as { PublicKeyCredential?: typeof PublicKeyCredential })
      .PublicKeyCredential;
    if (!PKC?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
    try {
      return await PKC.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  /** ¿El usuario ya registró Face ID en este dispositivo? */
  async isEnabled(): Promise<boolean> {
    return (await this.store.get(KEY_CRED)) !== null;
  }

  /** Activado Y utilizable en este dispositivo. */
  async isActive(): Promise<boolean> {
    return (await this.isEnabled()) && (await this.isSupported());
  }

  /**
   * Activa/desactiva. Al activar registra una credencial de plataforma (dispara
   * Face ID una vez para confirmar); solo guardamos el flag si el registro
   * funcionó. Devuelve el estado final.
   */
  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      await this.store.remove(KEY_CRED);
      return false;
    }
    const ok = await this.register();
    return ok;
  }

  /** Registro: crea la credencial de plataforma y guarda su id. */
  private async register(): Promise<boolean> {
    if (!(await this.isSupported())) return false;
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: this.randomBytes(32),
          rp: { name: 'CSD App', id: window.location.hostname },
          user: {
            id: this.randomBytes(16),
            name: 'csd-app',
            displayName: 'CSD App',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 }, // ES256
            { type: 'public-key', alg: -257 }, // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      })) as PublicKeyCredential | null;
      if (!cred) return false;
      await this.store.set(KEY_CRED, this.toB64Url(cred.rawId));
      return true;
    } catch {
      // Cancelación / no soportado / sin biometría enrolada → no activamos.
      return false;
    }
  }

  /**
   * Desbloqueo: pide una aserción con la credencial guardada. Éxito solo si el
   * usuario se verifica con Face ID/Touch ID. Requiere gesto del usuario (botón).
   */
  async authenticate(): Promise<boolean> {
    const credId = await this.store.get(KEY_CRED);
    if (!credId) return false;
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: this.randomBytes(32),
          rpId: window.location.hostname,
          allowCredentials: [{ type: 'public-key', id: this.fromB64Url(credId) }],
          userVerification: 'required',
          timeout: 60000,
        },
      });
      return assertion != null;
    } catch {
      // Cancelación → volver al PIN sin drama.
      return false;
    }
  }

  /** Borra la credencial (al cerrar sesión). El siguiente usuario re-registra. */
  async clear(): Promise<void> {
    await this.store.remove(KEY_CRED);
  }

  // --- helpers ------------------------------------------------------------

  private randomBytes(n: number): BufferSource {
    // Cast necesario por el typing de TS 5.9 (Uint8Array<ArrayBufferLike> no es
    // directamente BufferSource); mismo patrón que permissions.service.
    return crypto.getRandomValues(new Uint8Array(n)) as BufferSource;
  }

  private toB64Url(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private fromB64Url(s: string): BufferSource {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out as BufferSource;
  }
}
