import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculosService, FlotaAviso } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaMedia } from '../../../core/util/fecha';

const TIPO_LABEL: Record<string, string> = {
  seguro: 'Seguro por vencer',
  matricula: 'Matrícula por vencer',
  pre_cita: 'Pre-cita de mantenimiento',
  mantenimiento: 'Mantenimiento',
  hallazgos: 'Hallazgos de checklist',
  reporte_semanal: 'Reporte semanal pendiente',
  bloqueo: 'Vehículo bloqueado',
};

/** Avisos de flota (R6/R9): pre-cita, vencimientos, hallazgos + reactivar. */
@Component({
  selector: 'app-avisos-flota',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton],
  templateUrl: './avisos.html',
  styleUrl: './avisos.scss',
})
export class AvisosFlotaPage {
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  avisos = signal<FlotaAviso[]>([]);
  busyId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.avisos.set(await this.vehiculos.getAvisosFlota());
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t;
  }

  esBloqueo(a: FlotaAviso): boolean {
    return a.vehiculo?.estado === 'no_disponible';
  }

  /** Q2 — navegar al ÍTEM del aviso (no solo la acción inline). */
  puedeVer(a: FlotaAviso): boolean {
    return a.tipo === 'reporte_semanal' || !!a.vehiculo_id;
  }
  irAlItem(a: FlotaAviso): void {
    if (a.tipo === 'reporte_semanal') {
      // El destino resalta el vehículo señalado con ?item= (patrón Q2).
      void this.router.navigate(['/transporte/reporte-semanal'], {
        queryParams: a.vehiculo_id ? { item: a.vehiculo_id } : {},
      });
      return;
    }
    if (a.vehiculo_id) {
      void this.router.navigate(['/transporte/vehiculo', a.vehiculo_id]);
    }
  }

  async accion(a: FlotaAviso): Promise<void> {
    if (this.busyId()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para esto.');
      return;
    }
    this.busyId.set(a.id);
    try {
      if (this.esBloqueo(a) && a.vehiculo_id) {
        await this.vehiculos.reactivarVehiculo(a.vehiculo_id, null);
        this.toast.success('Vehículo reactivado.');
      } else {
        await this.vehiculos.atenderAviso(a.id, null);
        this.toast.success('Aviso marcado como atendido.');
      }
      this.avisos.update((list) => list.filter((x) => x.id !== a.id));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la acción.');
    } finally {
      this.busyId.set(null);
    }
  }

  back(): void {
    this.location.back();
  }
}
