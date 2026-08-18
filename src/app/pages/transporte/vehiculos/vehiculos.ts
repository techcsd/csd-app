import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { VehiculoCard } from '../../../shared/ui/vehiculo-card/vehiculo-card';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculosService, VehiculoEnUso } from '../../../core/services/vehiculos.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { VehiculoDisponible, vehiculoIdentidad } from '../../../core/models/transporte.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';

/** Browse the whole fleet → tap a vehicle to open its profile (R4). */
@Component({
  selector: 'app-vehiculos-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, VehiculoCard, EmptyState, Skeleton],
  templateUrl: './vehiculos.html',
  styleUrl: './vehiculos.scss',
})
export class VehiculosListaPage {
  private vehiculos = inject(VehiculosService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  esAdmin = () => this.ctx.hasModulo('admin');
  esFlotaElevado = this.ctx.esFlotaElevado; // AT10 — panel "en uso" solo supervisores

  ident = vehiculoIdentidad; // AT9
  fmtHora = formatFechaCortaHora; // AT17

  loading = signal(true);
  private todos = signal<VehiculoDisponible[]>([]);
  fotoUrls = signal<Record<string, string>>({});
  query = signal('');

  // AT10 — panel "Vehículos en uso" (colapsable).
  enUso = signal<VehiculoEnUso[]>([]);
  enUsoAbierto = signal(false);

  lista = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.todos();
    return this.todos().filter(
      (v) =>
        v.placa.toLowerCase().includes(q) ||
        v.marca.toLowerCase().includes(q) ||
        v.modelo.toLowerCase().includes(q) ||
        (v.tipo ?? '').toLowerCase().includes(q),
    );
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const flota = await this.vehiculos.getFlota();
      this.todos.set(flota);
      void this.resolveFotos(flota);
    } finally {
      this.loading.set(false);
    }
    // AT10 — carga aparte del panel "en uso" (best-effort; el RPC gatea por rol).
    if (this.esFlotaElevado()) {
      try {
        this.enUso.set(await this.vehiculos.getVehiculosEnUso());
      } catch {
        /* sin panel si el RPC no está disponible o no hay permiso */
      }
    }
  }

  toggleEnUso(): void {
    this.enUsoAbierto.update((v) => !v);
  }

  /** AT10 — ver al chofer que usa el vehículo en el mapa de Seguimiento. */
  verEnSeguimiento(u: VehiculoEnUso): void {
    void this.router.navigate(['/transporte/seguimiento'], { queryParams: { usuario: u.usuario_id } });
  }

  verPerfil(u: VehiculoEnUso): void {
    void this.router.navigate(['/transporte/vehiculo', u.vehiculo_id]);
  }

  private async resolveFotos(flota: VehiculoDisponible[]): Promise<void> {
    await Promise.all(
      flota
        .filter((v) => v.foto_path)
        .map(async (v) => {
          const url = await this.vehiculos.getFotoUrl(v.foto_path);
          if (url) this.fotoUrls.update((m) => ({ ...m, [v.vehiculo_id]: url }));
        }),
    );
  }

  ver(v: VehiculoDisponible): void {
    void this.router.navigate(['/transporte/vehiculo', v.vehiculo_id]);
  }

  nuevo(): void {
    void this.router.navigate(['/transporte/vehiculos/nuevo']);
  }

  back(): void {
    this.location.back();
  }
}
