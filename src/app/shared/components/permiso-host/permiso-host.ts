import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';

/**
 * X4 — pinta la tarjeta de permiso que dispara PermisoGateService. Montado una
 * sola vez en app.html (como el toast-host) para que cualquier flujo pueda
 * pedir un permiso con su explicación, sin cablear UI en cada página.
 */
@Component({
  selector: 'app-permiso-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './permiso-host.html',
  styleUrl: './permiso-host.scss',
})
export class PermisoHost {
  private gate = inject(PermisoGateService);
  card = this.gate.card;

  primary(): void {
    this.gate.primary();
  }

  secondary(): void {
    this.gate.secondary();
  }
}
