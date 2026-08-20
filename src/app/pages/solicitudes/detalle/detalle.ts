import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { RequisicionDetalle } from '../../../core/models/inventario.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** AS7/AS6 — Detalle completo de una requisición (destino del deep-link de la push):
 *  artículos, notas, estado, obra, solicitante, y links a conduce/compra. Read-only. */
@Component({
  selector: 'app-requisicion-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class RequisicionDetallePage {
  private service = inject(SolicitudesService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  req = signal<RequisicionDetalle | null>(null);
  error = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      const r = await this.service.detalle(id);
      if (!r) this.error.set(true);
      else this.req.set(r);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente': return 'Pendiente';
      case 'aprobada': return 'Aprobada';
      case 'entregada': return 'Entregada';
      case 'cerrada': return 'Cerrada';
      case 'rechazada': return 'Rechazada';
      default: return e;
    }
  }

  back(): void {
    this.location.back();
  }
}
