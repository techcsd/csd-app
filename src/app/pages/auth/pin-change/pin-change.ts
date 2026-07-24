import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { PinService } from '../../../core/services/pin.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * X10 — Cambiar el PIN estando ya desbloqueado (desde Ajustes). Pide el PIN
 * ACTUAL como salvaguarda, luego el nuevo dos veces. No toca la sesión ni el
 * servidor: solo re-escribe el hash local (PinService). Distinto de "¿Olvidaste
 * tu PIN?" (que re-verifica identidad contra el servidor).
 */
@Component({
  selector: 'app-pin-change',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad],
  templateUrl: './pin-change.html',
  styleUrl: './pin-change.scss',
})
export class PinChangePage {
  private pin = inject(PinService);
  private toast = inject(ToastService);
  private location = inject(Location);

  step = signal<'actual' | 'nuevo' | 'repetir'>('actual');
  value = signal('');
  private nuevo = signal('');

  async onCompleted(entered: string): Promise<void> {
    if (this.step() === 'actual') {
      const ok = await this.pin.verify(entered);
      this.value.set('');
      if (!ok) {
        this.toast.error('PIN actual incorrecto.');
        return;
      }
      this.step.set('nuevo');
      return;
    }
    if (this.step() === 'nuevo') {
      this.nuevo.set(entered);
      this.value.set('');
      this.step.set('repetir');
      return;
    }
    // repetir
    if (entered !== this.nuevo()) {
      this.toast.error('Los PIN no coinciden. Escribe el nuevo otra vez.');
      this.value.set('');
      this.nuevo.set('');
      this.step.set('nuevo');
      return;
    }
    try {
      await this.pin.setPin(entered);
      this.toast.success('PIN actualizado.');
      this.location.back();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el PIN.');
      this.value.set('');
      this.nuevo.set('');
      this.step.set('nuevo');
    }
  }

  back(): void {
    this.location.back();
  }
}
