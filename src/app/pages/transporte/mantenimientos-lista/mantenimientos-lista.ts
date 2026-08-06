import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MantenimientosService,
  MantenimientoItem,
  MANTENIMIENTO_TIPO_LABEL,
  MantenimientoTipo,
} from '../../../core/services/mantenimientos.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';

/**
 * AG9 — hub de mantenimientos de un vehículo desde la app: ver pendientes/en curso
 * e historial, entrar a registrar uno nuevo, y cerrar los pendientes con evidencia.
 */
@Component({
  selector: 'app-mantenimientos-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, Skeleton],
  templateUrl: './mantenimientos-lista.html',
  styleUrl: './mantenimientos-lista.scss',
})
export class MantenimientosListaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private mantenimientos = inject(MantenimientosService);
  private vehiculos = inject(VehiculosService);

  vehiculoId = '';
  placa = signal('');
  loading = signal(true);
  items = signal<MantenimientoItem[]>([]);

  /** Pendientes / en proceso arriba (accionables), historial (completados) abajo. */
  pendientes = computed(() => this.items().filter((m) => m.estado !== 'completado'));
  historial = computed(() => this.items().filter((m) => m.estado === 'completado'));

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const [veh, list] = await Promise.all([
        this.vehiculos.getVehiculo(this.vehiculoId).catch(() => null),
        this.mantenimientos.mantenimientosPorVehiculo(this.vehiculoId),
      ]);
      if (veh?.placa) this.placa.set(veh.placa);
      this.items.set(list);
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string): string {
    return MANTENIMIENTO_TIPO_LABEL[t as MantenimientoTipo] ?? t;
  }

  estadoLabel(e: string): string {
    return e === 'completado' ? 'Completado' : e === 'en_proceso' ? 'En proceso' : 'Pendiente';
  }

  back(): void {
    void this.router.navigate(['/transporte']);
  }

  registrar(): void {
    void this.router.navigate(['/transporte/mantenimiento', this.vehiculoId]);
  }

  cerrar(m: MantenimientoItem): void {
    void this.router.navigate(['/transporte/mantenimiento', this.vehiculoId, 'cerrar', m.id]);
  }
}
