import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { VehiculoCard } from '../vehiculo-card/vehiculo-card';
import { EmptyState } from '../empty-state/empty-state';
import { Skeleton } from '../skeleton/skeleton';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoDisponible } from '../../../core/models/transporte.model';

/**
 * B1 — reusable pool-of-vehicles picker (tarjetas con foto). Loads the shared
 * available pool (getVehiculosDisponibles, same as "asignarme"/semanal) and
 * emits the chosen vehicle. Used as an embedded step-1 in pre-uso, combustible
 * and rutas so a driver can start any flow without a prior assignment (U1/V10).
 */
@Component({
  selector: 'app-vehiculo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [VehiculoCard, EmptyState, Skeleton],
  templateUrl: './vehiculo-picker.html',
  styleUrl: './vehiculo-picker.scss',
})
export class VehiculoPicker {
  private vehiculos = inject(VehiculosService);

  /** Optional heading shown above the list. */
  titulo = input('Elige un vehículo');
  subtitulo = input('Selecciona el vehículo disponible para continuar.');

  elegido = output<VehiculoDisponible>();

  loading = signal(true);
  disponibles = signal<VehiculoDisponible[]>([]);
  fotoUrls = signal<Record<string, string>>({});

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const disp = await this.vehiculos.getVehiculosDisponibles();
      this.disponibles.set(disp);
      void this.resolveFotos(disp);
    } finally {
      this.loading.set(false);
    }
  }

  /** U6 — resolve pool photos to signed URLs (best-effort, online). */
  private async resolveFotos(disp: VehiculoDisponible[]): Promise<void> {
    await Promise.all(
      disp
        .filter((v) => v.foto_path)
        .map(async (v) => {
          const url = await this.vehiculos.getFotoUrl(v.foto_path);
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.vehiculo_id]: url }));
        }),
    );
  }

  elegir(v: VehiculoDisponible): void {
    this.elegido.emit(v);
  }
}
