import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { RetirosService } from '../../../core/services/retiros.service';
import { NetworkService } from '../../../core/services/network.service';
import { formatFechaRelativa } from '../../../core/util/fecha';
import {
  RetiroListado,
  RETIRO_ESTADO_LABEL,
  RETIRO_MOTIVO_LABEL,
  retiroCodigo,
} from '../../../core/models/retiro.model';

/**
 * BG4 — "Mis retiros": el ingeniero ve el estado de sus solicitudes de retiro
 * (pendiente / aprobada / en retiro / cuarentena / dispuesta / rechazada), mismo
 * patrón que "Mis requisiciones".
 */
@Component({
  selector: 'app-retiros',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './retiros.html',
  styleUrl: './retiros.scss',
})
export class RetirosPage {
  private retiros = inject(RetirosService);
  private network = inject(NetworkService);
  private location = inject(Location);
  private router = inject(Router);

  items = signal<RetiroListado[]>([]);
  loading = signal(true);
  online = this.network.online;
  fmt = formatFechaRelativa;
  codigo = retiroCodigo;
  estadoLabel = RETIRO_ESTADO_LABEL;
  motivoLabel = RETIRO_MOTIVO_LABEL;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.retiros.misRetiros());
    } finally {
      this.loading.set(false);
    }
  }

  async refrescar(): Promise<void> {
    await this.retiros.invalidarCache();
    await this.load();
  }

  abrir(item: RetiroListado): void {
    void this.router.navigate(['/inventario/retiro', item.id]);
  }
  nuevo(): void {
    void this.router.navigate(['/inventario/retiro/nuevo']);
  }
  back(): void {
    this.location.back();
  }
}
