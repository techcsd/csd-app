import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ConducesService, RequisicionPorDespachar } from '../../../core/services/conduces.service';

/**
 * BA/Transporte v3 (FASE 2) — "Por despachar": requisiciones aprobadas que esperan
 * su(s) conduce(s). El chofer "jala" una → abre el conduce con los renglones
 * predeterminados de la requisición (editables) ya enlazado. La aprobación deja de
 * generar conduce automático cuando Xaviel apaga `requisicion_auto_conduce`.
 */
@Component({
  selector: 'app-despachos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, LiveRefreshDirective],
  templateUrl: './despachos.html',
  styleUrl: './despachos.scss',
})
export class DespachosPage {
  private conduces = inject(ConducesService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  error = signal('');
  requisiciones = signal<RequisicionPorDespachar[]>([]);

  constructor() {
    void this.cargar();
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.error.set('');
    try {
      this.requisiciones.set(await this.conduces.requisicionesPorDespachar());
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'No se pudieron cargar las requisiciones.');
    } finally {
      this.loading.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.cargar(silent);
  }

  /** Jala la requisición → abre el conduce con sus renglones (editables) y el vínculo. */
  despachar(r: RequisicionPorDespachar): void {
    void this.router.navigate(['/transporte/generar-conduce'], {
      queryParams: { requisicion: r.id, obra: r.proyecto_id, origen: 'almacen' },
    });
  }

  back(): void {
    this.location.back();
  }
}
