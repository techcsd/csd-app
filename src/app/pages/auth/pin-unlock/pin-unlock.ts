import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PinService, MAX_PIN_ATTEMPTS } from '../../../core/services/pin.service';
import { SessionService } from '../../../core/services/session.service';
import { BiometricService } from '../../../core/services/biometric.service';
import { WebauthnService } from '../../../core/services/webauthn.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Daily re-entry. PIN, plus optional biometric unlock (R10) that only confirms
 * the device owner — the PIN is always available as the fallback. After
 * MAX_PIN_ATTEMPTS failures we wipe the session and force a full login.
 */
@Component({
  selector: 'app-pin-unlock',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad, ConfirmDialog],
  templateUrl: './pin-unlock.html',
  styleUrl: './pin-unlock.scss',
})
export class PinUnlockPage {
  private pin = inject(PinService);
  private session = inject(SessionService);
  private biometric = inject(BiometricService);
  private webauthn = inject(WebauthnService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private toast = inject(ToastService);

  value = signal('');
  attemptsLeft = signal(MAX_PIN_ATTEMPTS);
  biometriaDisponible = signal(false);
  faceIdDisponible = signal(false); // X8 — PWA (Face ID/Touch ID vía WebAuthn)
  confirmReset = signal(false); // X10 — confirmar "¿Olvidaste tu PIN?"

  constructor() {
    void this.tryBiometric();
    void this.checkFaceId();
    // APP-045: hidratar los intentos restantes (persisten entre reinicios).
    void this.pin.attemptsLeft().then((n) => this.attemptsLeft.set(n));
  }

  /** Offer biometric unlock on entry when the user enabled it. PIN stays available. */
  private async tryBiometric(): Promise<void> {
    if (!(await this.biometric.isActive())) return;
    this.biometriaDisponible.set(true);
    await this.unlockConHuella();
  }

  /** X8 — en el PWA ofrecemos Face ID por botón (WebAuthn exige gesto del
   *  usuario, así que NO lo lanzamos solo al entrar). */
  private async checkFaceId(): Promise<void> {
    this.faceIdDisponible.set(await this.webauthn.isActive());
  }

  async unlockConHuella(): Promise<void> {
    const ok = await this.biometric.authenticate('Desbloquea CSD con tu huella o rostro');
    if (ok) {
      this.session.markUnlocked();
      await this.router.navigate(['/home']);
    }
  }

  /** X8 — desbloqueo con Face ID / Touch ID (PWA). El PIN sigue como fallback. */
  async unlockConFaceId(): Promise<void> {
    const ok = await this.webauthn.authenticate();
    if (ok) {
      this.session.markUnlocked();
      await this.router.navigate(['/home']);
      return;
    }
    // Cancelación o credencial inválida → sin drama, se queda en el PIN.
    this.toast.show('Usa tu PIN para entrar.', 'info', 2500);
  }

  // --- X10 — ¿Olvidaste tu PIN? ------------------------------------------

  /**
   * Restablecer el PIN es un autoservicio: cerramos la sesión y el usuario
   * vuelve a entrar con su identidad real (correo+clave o cédula+PIN de acceso);
   * tras entrar, el flujo normal lo lleva a crear un PIN nuevo (pin-setup). No
   * hay infra paralela. Requiere señal — offline avisamos, nunca dejamos un
   * callejón sin salida (no cerramos sesión si no hay internet).
   */
  olvidePin(): void {
    if (!this.network.online()) {
      this.toast.error('Para restablecer tu PIN necesitas internet. Conéctate e inténtalo de nuevo.');
      return;
    }
    this.confirmReset.set(true);
  }

  cancelarReset(): void {
    this.confirmReset.set(false);
  }

  async confirmarReset(): Promise<void> {
    this.confirmReset.set(false);
    await this.session.logout();
    await this.router.navigate(['/auth/login']);
  }

  async onCompleted(entered: string): Promise<void> {
    const ok = await this.pin.verify(entered);
    if (ok) {
      this.session.markUnlocked();
      await this.router.navigate(['/home']);
      return;
    }
    const left = await this.pin.attemptsLeft();
    this.attemptsLeft.set(left);
    this.value.set('');
    if (left <= 0) {
      await this.session.logout();
      this.toast.error('Demasiados intentos. Entra con tu contraseña.');
      await this.router.navigate(['/auth/login']);
      return;
    }
    this.toast.error(`PIN incorrecto. Te quedan ${left} intentos.`);
  }
}
