import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { VehiculosService } from '../../core/services/vehiculos.service';
import { ReporteSemanalService } from '../../core/services/reporte-semanal.service';
import { MiAsignacion, PendientesTransporte } from '../../core/models/transporte.model';

/** Transporte hub: vehicles to receive / already in charge / self-assigned. */
@Component({
  selector: 'app-transporte',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, DecimalPipe],
  templateUrl: './transporte.html',
  styleUrl: './transporte.scss',
})
export class TransportePage {
  private vehiculos = inject(VehiculosService);
  private reportes = inject(ReporteSemanalService);
  private router = inject(Router);
  private location = inject(Location);

  pendientes = signal<PendientesTransporte>({ a_cargo: [], por_recibir: [] });
  asignaciones = signal<MiAsignacion[]>([]);
  reporteSemanalPend = signal(0);
  loading = signal(true);

  /** Active assignments not already shown in a_cargo / por_recibir (multi-asignación). */
  otrasAsignaciones = computed(() => {
    const known = new Set([
      ...this.pendientes().a_cargo.map((v) => v.vehiculo_id),
      ...this.pendientes().por_recibir.map((v) => v.vehiculo_id),
    ]);
    return this.asignaciones().filter((a) => !known.has(a.vehiculo_id));
  });

  vacio = computed(
    () =>
      !this.pendientes().a_cargo.length &&
      !this.pendientes().por_recibir.length &&
      !this.otrasAsignaciones().length,
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [pend, asig, semanalPend] = await Promise.all([
        this.vehiculos.misPendientes(),
        this.vehiculos.getMisAsignaciones(),
        this.reportes.pendientesCount(),
      ]);
      this.pendientes.set(pend);
      this.asignaciones.set(asig);
      this.reporteSemanalPend.set(semanalPend);
    } finally {
      this.loading.set(false);
    }
  }

  asignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  reporteSemanal(): void {
    void this.router.navigate(['/transporte/reporte-semanal']);
  }

  perfilVehiculo(vehiculoId: string): void {
    void this.router.navigate(['/transporte/vehiculo', vehiculoId]);
  }

  miActividad(): void {
    void this.router.navigate(['/transporte/mi-actividad']);
  }

  vehiculosLista(): void {
    void this.router.navigate(['/transporte/vehiculos']);
  }

  conductoresLista(): void {
    void this.router.navigate(['/transporte/conductores']);
  }

  avisos(): void {
    void this.router.navigate(['/transporte/avisos']);
  }

  recibir(vehiculoId: string): void {
    void this.router.navigate(['/transporte/recibir', vehiculoId]);
  }

  devolver(vehiculoId: string): void {
    void this.router.navigate(['/transporte/devolver', vehiculoId]);
  }

  preuso(vehiculoId: string): void {
    void this.router.navigate(['/transporte/preuso', vehiculoId]);
  }

  mantenimiento(vehiculoId: string): void {
    void this.router.navigate(['/transporte/mantenimiento', vehiculoId]);
  }

  combustible(vehiculoId: string): void {
    void this.router.navigate(['/transporte/combustible', vehiculoId]);
  }

  conduces(): void {
    void this.router.navigate(['/transporte/conduces']);
  }

  back(): void {
    this.location.back();
  }
}
