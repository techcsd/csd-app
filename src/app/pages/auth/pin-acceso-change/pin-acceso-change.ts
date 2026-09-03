import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { PinPad } from '../../../shared/ui/pin-pad/pin-pad';
import { AuthService } from '../../../core/services/auth.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * BI6 (FASE 5) — Cambiar el PIN de ACCESO (6 dígitos: el de cédula + PIN que vive en
 * auth.users), estando ya dentro. Distinto de "Bloqueo de la app" (PIN local de 4
 * dígitos que solo protege el dispositivo). Pide el PIN actual, luego el nuevo dos
 * veces, y lo cambia CONTRA EL SERVIDOR (edge `acceso-cedula` modo self, auditado).
 * Requiere conexión. Solo se ofrece a usuarios de acceso por cédula (perfil).
 */
@Component({
  selector: 'app-pin-acceso-change',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PinPad],
  templateUrl: './pin-acceso-change.html',
  styleUrl: './pin-acceso-change.scss',
})
export class PinAccesoChangePage {
  private auth = inject(AuthService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);

  online = this.network.online;
  step = signal<'actual' | 'nuevo' | 'repetir'>('actual');
  value = signal('');
  guardando = signal(false);
  private actual = signal('');
  private nuevo = signal('');

  onCompleted(entered: string): void {
    if (this.guardando()) return;
    if (this.step() === 'actual') {
      this.actual.set(entered);
      this.value.set('');
      this.step.set('nuevo');
      return;
    }
    if (this.step() === 'nuevo') {
      // Rechazo local del PIN igual al actual (el servidor también lo valida, pero
      // avisar aquí evita un viaje de red y un mensaje tardío).
      if (entered === this.actual()) {
        this.toast.error('El PIN nuevo debe ser distinto del actual.');
        this.value.set('');
        return;
      }
      this.nuevo.set(entered);
      this.value.set('');
      this.step.set('repetir');
      return;
    }
    // repetir
    if (entered !== this.nuevo()) {
      this.toast.error('Los PIN no coinciden. Escribe el nuevo otra vez.');
      this.reiniciarNuevo();
      return;
    }
    void this.guardar();
  }

  private async guardar(): Promise<void> {
    if (!this.online()) {
      this.toast.error('Necesitas conexión para cambiar tu PIN de acceso.');
      this.reiniciarNuevo();
      return;
    }
    this.guardando.set(true);
    try {
      await this.auth.cambiarMiPinAcceso(this.actual(), this.nuevo());
      this.toast.success('PIN de acceso actualizado. Úsalo la próxima vez que entres con tu cédula.');
      this.location.back();
    } catch (e) {
      // Un PIN actual incorrecto manda de vuelta al primer paso; el resto reintenta el nuevo.
      const msg = e instanceof Error ? e.message : 'No se pudo cambiar el PIN de acceso.';
      this.toast.error(msg);
      if (/actual/i.test(msg)) {
        this.actual.set('');
        this.nuevo.set('');
        this.value.set('');
        this.step.set('actual');
      } else {
        this.reiniciarNuevo();
      }
    } finally {
      this.guardando.set(false);
    }
  }

  private reiniciarNuevo(): void {
    this.value.set('');
    this.nuevo.set('');
    this.step.set('nuevo');
  }

  back(): void {
    this.location.back();
  }
}
