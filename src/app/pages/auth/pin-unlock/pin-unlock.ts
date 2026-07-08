import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { PinService, MAX_PIN_ATTEMPTS } from '../../../core/services/pin.service';
import { SessionService } from '../../../core/services/session.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * Daily re-entry. PIN only — no password, no network required. After
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
  private router = inject(Router);
  private toast = inject(ToastService);

  value = signal('');
  attemptsLeft = signal(MAX_PIN_ATTEMPTS);

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
