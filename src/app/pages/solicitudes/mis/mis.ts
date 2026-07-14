import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DatePipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { Solicitud } from '../../../core/models/inventario.model';

/** Track my material requests: Enviada → Aprobada → Entregada. */
@Component({
  selector: 'app-mis-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DatePipe],
  templateUrl: './mis.html',
  styleUrl: './mis.scss',
})
export class MisSolicitudesPage {
  private service = inject(SolicitudesService);
  private router = inject(Router);
  private location = inject(Location);

  nueva(): void {
    void this.router.navigate(['/solicitudes/pedir']);
  }

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
      case 'cerrada':
        return 'Completada';
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
