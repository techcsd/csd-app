import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { PinService } from '../../../core/services/pin.service';
import { SessionService } from '../../../core/services/session.service';
import { ToastService } from '../../../core/services/toast.service';

/** Create the local PIN: enter, then repeat to confirm (User Flow §2). */
@Component({
  selector: 'app-pin-setup',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad],
  templateUrl: './pin-setup.html',
  styleUrl: './pin-setup.scss',
})
export class PinSetupPage {
  private pin = inject(PinService);
  private session = inject(SessionService);
  private router = inject(Router);
  private toast = inject(ToastService);

  step = signal<'crear' | 'repetir'>('crear');
  first = signal('');
  value = signal('');

  async onCompleted(entered: string): Promise<void> {
    if (this.step() === 'crear') {
      this.first.set(entered);
      this.value.set('');
      this.step.set('repetir');
      return;
    }
    if (entered !== this.first()) {
      this.toast.error('Los PIN no coinciden. Empecemos de nuevo.');
      this.reset();
      return;
    }
    try {
      await this.pin.setPin(entered);
      this.session.markUnlocked();
      await this.router.navigate(['/home']);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el PIN.');
      this.reset();
    }
  }

  private reset(): void {
    this.first.set('');
    this.value.set('');
    this.step.set('crear');
  }
}
