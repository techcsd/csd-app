import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService } from '../../../core/services/conduces.service';
import { ToastService } from '../../../core/services/toast.service';
import { Conduce, RutaHoy } from '../../../core/models/transporte.model';

/** Driver's routes + dispatched conduces for the day. */
@Component({
  selector: 'app-conduces',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar, DecimalPipe],
  templateUrl: './conduces.html',
  styleUrl: './conduces.scss',
})
export class ConducesPage {
  private service = inject(ConducesService);
  private router = inject(Router);
  private location = inject(Location);
  private toast = inject(ToastService);

  conduces = signal<Conduce[]>([]);
  rutas = signal<RutaHoy[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [c, r] = await Promise.all([this.service.misConduces(), this.service.misRutas()]);
      this.conduces.set(c);
      this.rutas.set(r);
    } finally {
      this.loading.set(false);
    }
  }

  entregar(conduce: Conduce): void {
    void this.router.navigate(['/transporte/conduces', conduce.id]);
  }

  async ruta(rutaId: string, estado: 'en_curso' | 'completada'): Promise<void> {
    try {
      await this.service.marcarRuta(rutaId, estado);
      this.rutas.update((list) =>
        list.map((r) => (r.id === rutaId ? { ...r, estado } : r)),
      );
    } catch {
      this.toast.error('Sin señal. Vuelve a intentar la ruta cuando tengas conexión.');
    }
  }

  back(): void {
    this.location.back();
  }
}
