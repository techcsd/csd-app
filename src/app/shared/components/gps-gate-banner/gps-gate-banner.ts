import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TrackingService } from '../../../core/services/tracking.service';
import { PermissionsService } from '../../../core/services/permissions.service';

/**
 * AF26 — banner persistente cuando el GPS está apagado o el permiso revocado.
 * Se muestra en las pantallas de transporte; explica el porqué y ofrece activarlo.
 * El bloqueo real de funciones vive en TrackingService.exigirGps().
 */
@Component({
  selector: 'app-gps-gate-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gps-gate-banner.html',
  styleUrl: './gps-gate-banner.scss',
})
export class GpsGateBanner {
  private tracking = inject(TrackingService);
  private permissions = inject(PermissionsService);

  bloqueado = this.tracking.gpsBloqueado;
  motivo = this.tracking.gpsMotivo;

  mensaje = computed(() =>
    this.motivo() === 'permiso'
      ? 'La ubicación está desactivada. La empresa necesita saber dónde estás durante el trabajo. Actívala para crear rutas, conduces y marcar entregas.'
      : 'El GPS del teléfono está apagado. Enciéndelo para crear rutas, conduces y marcar entregas.',
  );

  constructor() {
    void this.tracking.revisarGps();
  }

  async activar(): Promise<void> {
    if (this.motivo() === 'permiso') {
      await this.permissions.requestLocation();
      await this.permissions.openAppSettings();
    }
    await this.tracking.revisarGps();
  }
}
