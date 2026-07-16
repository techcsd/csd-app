import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { PinService, MAX_PIN_ATTEMPTS } from '../../../core/services/pin.service';
import { SessionService } from '../../../core/services/session.service';
import { BiometricService } from '../../../core/services/biometric.service';
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
  imports: [PinPad],
  templateUrl: './pin-unlock.html',
  styleUrl: './pin-unlock.scss',
})
export class PinUnlockPage {
  private pin = inject(PinService);
  private session = inject(SessionService);
  private biometric = inject(BiometricService);
  private router = inject(Router);
  private toast = inject(ToastService);

  value = signal('');
  attemptsLeft = signal(MAX_PIN_ATTEMPTS);
  biometriaDisponible = signal(false);

  constructor() {
    void this.tryBiometric();
    // APP-045: hidratar los intentos restantes (persisten entre reinicios).
    void this.pin.attemptsLeft().then((n) => this.attemptsLeft.set(n));
  }

  /** Offer biometric unlock on entry when the user enabled it. PIN stays available. */
  private async tryBiometric(): Promise<void> {
    if (!(await this.biometric.isActive())) return;
    this.biometriaDisponible.set(true);
    await this.unlockConHuella();
  }

  async unlockConHuella(): Promise<void> {
    const ok = await this.biometric.authenticate('Desbloquea CSD con tu huella o rostro');
    if (ok) {
      this.session.markUnlocked();
      await this.router.navigate(['/home']);
    }
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
