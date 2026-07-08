import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { Solicitud } from '../../../core/models/inventario.model';

/** Track my material requests: Enviada → Aprobada → Entregada. */
@Component({
  selector: 'app-mis-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe],
  templateUrl: './mis.html',
  styleUrl: './mis.scss',
})
export class MisSolicitudesPage {
  private service = inject(SolicitudesService);
  private location = inject(Location);

  solicitudes = signal<Solicitud[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.solicitudes.set(await this.service.misSolicitudes());
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente':
        return 'Enviada';
      case 'aprobada':
        return 'Aprobada';
      case 'entregada':
        return 'Recibida';
      case 'rechazada':
        return 'Rechazada';
      default:
        return e;
    }
  }

  back(): void {
    this.location.back();
  }
}
