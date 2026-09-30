import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConducesService, ConduceExternoRow } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';
import { formatFechaRelativa } from '../../../core/util/fecha';

/**
 * CC5 — "Mis conduces externos": el conduce externo ahora es un conduce de verdad
 * (número CE-000123, ficha y PDF). Lista los del servidor + los que aún están en el
 * outbox (Pendiente de enviar). Cada fila abre su ficha. BL2 — distingue "vacío" de
 * "falló" (reintento).
 */
@Component({
  selector: 'app-conduce-externo-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe],
  templateUrl: './conduce-externo-lista.html',
  styleUrl: './conduce-externo-lista.scss',
})
export class ConduceExternoListaPage {
  private conduces = inject(ConducesService);
  private net = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);

  loading = signal(true);
  fallo = signal(false);
  rows = signal<ConduceExternoRow[]>([]);
  online = this.net.online;
  fmt = formatFechaRelativa;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.fallo.set(false);
    try {
      this.rows.set(await this.conduces.conducesExternos());
    } catch {
      this.fallo.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(r: ConduceExternoRow): string {
    if (r.pendiente) return r.estado === 'error' ? this.i18n.t('Con problema') : this.i18n.t('Pendiente de enviar');
    switch (r.estado) {
      case 'emitido':
        return this.i18n.t('Emitido');
      case 'recibido':
        return this.i18n.t('Recibido');
      case 'anulado':
        return this.i18n.t('Anulado');
      default:
        return r.estado ?? '—';
    }
  }

  abrir(r: ConduceExternoRow): void {
    void this.router.navigate(['/transporte/conduce-externo', r.id], {
      queryParams: r.pendiente ? { pendiente: 1 } : undefined,
    });
  }

  nuevo(): void {
    void this.router.navigate(['/transporte/conduce-externo']);
  }

  back(): void {
    this.location.back();
  }
}
