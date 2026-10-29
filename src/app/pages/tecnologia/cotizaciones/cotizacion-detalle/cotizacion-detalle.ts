import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CotizacionesService } from '../../../../core/services/cotizaciones.service';
import { CotizacionDetalle } from '../../../../core/models/cotizacion.model';
import { Skeleton } from '../../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../../shared/ui/empty-state/empty-state';
import { PdfViewer } from '../../../../shared/ui/pdf-viewer/pdf-viewer';
import { TranslatePipe } from '../../../../core/i18n/translate.pipe';
import { formatFechaMedia } from '../../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../../shared/motion';

/** CZ6 — ficha de solo lectura de una cotización: archivo + vínculos. */
@Component({
  selector: 'app-cotizacion-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, PdfViewer, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './cotizacion-detalle.html',
  styleUrl: './cotizacion-detalle.scss',
})
export class CotizacionDetallePage {
  private service = inject(CotizacionesService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  error = signal(false);
  detalle = signal<CotizacionDetalle | null>(null);
  verPdf = signal(false);

  constructor() {
    void this.cargar();
  }

  private async cargar(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.error.set(true);
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      const det = await this.service.detalle(id);
      if (!det) this.error.set(true);
      this.detalle.set(det);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  esPdf(nombre: string | null): boolean {
    return !!nombre && /\.pdf$/i.test(nombre);
  }

  back(): void {
    void this.router.navigate(['/tecnologia/cotizaciones']);
  }
}
