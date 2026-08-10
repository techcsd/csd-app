import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AlarmaService } from '../../../core/services/alarma.service';

/**
 * AK10 — overlay a pantalla completa de la alarma dominical del reporte semanal.
 * Se monta en app.html (como ToastHost); aparece cuando AlarmaService.activa().
 */
@Component({
  selector: 'app-alarma-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './alarma-host.html',
  styleUrl: './alarma-host.scss',
})
export class AlarmaHost {
  private alarma = inject(AlarmaService);
  activa = this.alarma.activa;

  hacerReporte(): void {
    this.alarma.hacerReporte();
  }
  posponer(): void {
    this.alarma.posponer();
  }
}
