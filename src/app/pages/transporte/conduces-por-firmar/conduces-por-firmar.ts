import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, ConducePorFirmar } from '../../../core/services/conduces.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

/**
 * AU1 — bandeja del DESPACHANTE: conduces donde YO fui elegido como despachante y
 * aún no he firmado. El chofer no puede marcar la entrega hasta que yo firme
 * (regla server-side DR456). Cada fila abre el detalle del conduce, donde vive el
 * bloque de firma (conduce-detalle → puedeFirmarDespachante). Solo lectura + push:
 * el destino del recordatorio (tipo 'conduce_firma') es esta pantalla.
 */
@Component({
  selector: 'app-conduces-por-firmar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, LiveRefreshDirective],
  templateUrl: './conduces-por-firmar.html',
  styleUrl: './conduces-por-firmar.scss',
})
export class ConducesPorFirmarPage {
  private conduces = inject(ConducesService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);

  fmtFecha = formatFecha;

  loading = signal(true);
  refrescando = signal(false);
  conduces_ = signal<ConducePorFirmar[]>([]);

  constructor() {
    void this.load();
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.conduces_.set(await this.conduces.misConducesPorFirmar());
    } catch {
      this.toast.error('No pudimos cargar los conduces por firmar.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  /** CND-XXXXXXXX derivado del id (mismo formato que la web / conduce_detalle_app). */
  numero(id: string): string {
    return 'CND-' + id.slice(0, 8).toUpperCase();
  }

  firmar(id: string): void {
    void this.router.navigate(['/transporte/conduce-detalle', id]);
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
