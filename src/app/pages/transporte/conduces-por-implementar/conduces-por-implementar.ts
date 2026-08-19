import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, ConducePorImplementar } from '../../../core/services/conduces.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

/**
 * AY13 — "Conduces por implementar": conduces con ≥1 ítem libre aún SIN vincular a
 * un artículo del catálogo (no generaron movimiento real de inventario). El vínculo
 * del artículo es tarea del ADMIN en la web (AY12); la app SOLO refleja la lista con
 * su badge. Al vincularse el artículo, el conduce sale de aquí. Read-only.
 */
@Component({
  selector: 'app-conduces-por-implementar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, LiveRefreshDirective],
  templateUrl: './conduces-por-implementar.html',
  styleUrl: './conduces-por-implementar.scss',
})
export class ConducesPorImplementarPage {
  private conduces = inject(ConducesService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);

  fmtFecha = formatFecha;

  loading = signal(true);
  refrescando = signal(false);
  conduces_ = signal<ConducePorImplementar[]>([]);

  constructor() {
    void this.load();
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.conduces_.set(await this.conduces.conducesPorImplementar());
    } catch {
      this.toast.error('No pudimos cargar los conduces por implementar.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  numero(c: ConducePorImplementar): string {
    return c.conduce_numero || 'CND-' + c.salida_id.slice(0, 8).toUpperCase();
  }

  abrir(c: ConducePorImplementar): void {
    void this.router.navigate(['/transporte/conduce-detalle', c.salida_id]);
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
