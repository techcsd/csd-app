import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConductoresService } from '../../../core/services/conductores.service';
import { NetworkService } from '../../../core/services/network.service';
import { CedulaPipe } from '../../pipes/cedula-pipe';
import { humanizeError } from '../../util/friendly-error.util';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * P8 — modal para generar el acceso a la app de un conductor (usuario = cédula,
 * PIN de 6 dígitos) o restablecer su PIN. Llama la edge `conductor-crear-acceso`
 * (misma que la web, gated a admin/flota). Online-only: sin señal, deshabilita.
 */
@Component({
  selector: 'app-generar-acceso',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CedulaPipe, TranslatePipe],
  templateUrl: './generar-acceso.html',
  styleUrl: './generar-acceso.scss',
})
export class GenerarAcceso {
  private conductores = inject(ConductoresService);
  private network = inject(NetworkService);
  private i18n = inject(I18nService);

  open = input(false);
  conductorId = input.required<string>();
  cedula = input('');
  /** true → botón/título dicen "Restablecer PIN"; false → "Generar acceso". */
  tieneAcceso = input(false);

  cerrado = output<void>();
  generado = output<{ usuarioId: string; rotated?: boolean }>();

  pin = signal('');
  error = signal('');
  submitting = signal(false);
  exito = signal('');

  online = this.network.online;

  constructor() {
    // Limpiar el estado cada vez que se abre.
    effect(() => {
      if (this.open()) {
        this.pin.set('');
        this.error.set('');
        this.exito.set('');
        this.submitting.set(false);
      }
    });
  }

  onPin(v: string): void {
    // Solo dígitos, máx 6.
    this.pin.set(v.replace(/\D/g, '').slice(0, 6));
    this.error.set('');
  }

  async generar(): Promise<void> {
    if (this.submitting()) return;
    if (!/^\d{6}$/.test(this.pin())) {
      this.error.set(this.i18n.t('El PIN debe ser de 6 dígitos.'));
      return;
    }
    if (!this.online()) {
      this.error.set(this.i18n.t('Necesitas conexión para generar el acceso.'));
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    try {
      const res = await this.conductores.generarAccesoConductor(this.conductorId(), this.pin());
      const ced = this.cedula() ? ` (${this.cedula()})` : '';
      this.exito.set(
        res.rotated
          ? this.i18n.t('PIN restablecido. El conductor entra con su cédula{ced} y el nuevo PIN.', { ced })
          : this.i18n.t('Acceso generado. El conductor entra con su cédula{ced} y el PIN.', { ced }),
      );
      this.generado.emit({ usuarioId: res.usuarioId, rotated: res.rotated });
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudo generar el acceso.'));
    } finally {
      this.submitting.set(false);
    }
  }

  cerrar(): void {
    this.cerrado.emit();
  }
}
