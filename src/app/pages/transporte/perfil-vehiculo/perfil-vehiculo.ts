import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoStats } from '../../../core/models/transporte.model';

/** Read-only vehicle profile: info + aggregated stats (R4). */
@Component({
  selector: 'app-perfil-vehiculo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState],
  templateUrl: './perfil-vehiculo.html',
  styleUrl: './perfil-vehiculo.scss',
})
export class PerfilVehiculoPage {
  private route = inject(ActivatedRoute);
  private vehiculos = inject(VehiculosService);
  private location = inject(Location);

  loading = signal(true);
  placa = signal('');
  modelo = signal('');
  fotoUrl = signal<string | null>(null); // U6
  stats = signal<VehiculoStats | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    this.loading.set(true);
    try {
      const [veh, stats] = await Promise.all([
        this.vehiculos.getVehiculo(id),
        this.vehiculos.getVehiculoStats(id),
      ]);
      if (veh) {
        this.placa.set(veh.placa);
        this.modelo.set(`${veh.marca} ${veh.modelo}`);
        if (veh.foto_path) this.fotoUrl.set(await this.vehiculos.getFotoUrl(veh.foto_path));
      }
      this.stats.set(stats);
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
