import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ClLiberacionService } from '../../../core/services/cl-liberacion.service';
import { NetworkService } from '../../../core/services/network.service';
import { ClPendiente } from '../../../core/models/cl-liberacion.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * Q5 (3b) — bandeja "Liberaciones por firmar": CLs en borrador pendientes de
 * firma. Al tocar uno se abre su detalle para revisarlo y firmar. Online (los
 * CL viven en el servidor; pueden haberse creado en otro dispositivo).
 */
@Component({
  selector: 'app-cl-firmas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './cl-firmas.html',
  styleUrl: './cl-firmas.scss',
})
export class ClFirmasPage {
  private service = inject(ClLiberacionService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  error = signal(false);
  items = signal<ClPendiente[]>([]);
  fmt = formatFechaMedia;
  online = this.network.online;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.items.set(await this.service.getClsPendientes());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  abrir(id: string): void {
    void this.router.navigate(['/bitacora/cl', id]);
  }
  back(): void {
    this.location.back();
  }
}
