import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { DatePipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { BitacoraService } from '../../../core/services/bitacora.service';
import { BitacoraFull } from '../../../core/models/bitacora.model';

/** My bitácoras (server, offline-cached). Tap one to see its details. */
@Component({
  selector: 'app-mis-bitacoras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, DatePipe],
  templateUrl: './mis-partes.html',
  styleUrl: './mis-partes.scss',
})
export class MisPartesPage {
  private bitacora = inject(BitacoraService);
  private router = inject(Router);
  private location = inject(Location);

  bitacoras = signal<BitacoraFull[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.bitacoras.set(await this.bitacora.misBitacoras());
    } finally {
      this.loading.set(false);
    }
  }

  titulo(b: BitacoraFull): string {
    return b.tipo === 'incidente' ? 'Incidente' : b.tipo === 'visita' ? 'Visita' : 'Bitácora del día';
  }

  open(b: BitacoraFull): void {
    void this.router.navigate(['/bitacora/detalle', b.id]);
  }

  nueva(): void {
    void this.router.navigate(['/bitacora/parte']);
  }

  back(): void {
    this.location.back();
  }
}
