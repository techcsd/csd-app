import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { SyncService } from '../../../core/sync/sync.service';
import {
  MantenimientosService,
  MantenimientoItem,
  MANTENIMIENTO_TIPO_LABEL,
  MantenimientoTipo,
} from '../../../core/services/mantenimientos.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { MantAdjuntos } from '../../../shared/ui/mant-adjuntos/mant-adjuntos';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * AG9 — hub de mantenimientos de un vehículo desde la app: ver pendientes/en curso
 * e historial, entrar a registrar uno nuevo, y cerrar los pendientes con evidencia.
 */
@Component({
  selector: 'app-mantenimientos-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, Skeleton, EmptyState, MantAdjuntos, TranslatePipe],
  templateUrl: './mantenimientos-lista.html',
  styleUrl: './mantenimientos-lista.scss',
})
export class MantenimientosListaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private mantenimientos = inject(MantenimientosService);
  private vehiculos = inject(VehiculosService);
  private sync = inject(SyncService);

  vehiculoId = '';
  placa = signal('');
  loading = signal(true);
  fallo = signal(false); // 8ª regla — "la consulta falló" ≠ "no hay mantenimientos"
  items = signal<MantenimientoItem[]>([]);

  /** Pendientes / en proceso arriba (accionables), historial (completados) abajo. */
  pendientes = computed(() => this.items().filter((m) => m.estado !== 'completado'));
  historial = computed(() => this.items().filter((m) => m.estado === 'completado'));

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    // Recarga al entrar Y tras cada drain del outbox: un adjunto/mantenimiento recién
    // encolado aparece en el historial cuando el servidor confirma.
    effect(() => {
      this.sync.changed();
      void this.cargar();
    });
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.fallo.set(false);
    try {
      const [veh, res] = await Promise.all([
        this.vehiculos.getVehiculo(this.vehiculoId).catch(() => null),
        this.mantenimientos.mantenimientosPorVehiculoDetailed(this.vehiculoId),
      ]);
      if (veh?.placa) this.placa.set(veh.placa);
      this.items.set(res.items);
      // 8ª regla — solo "vacío" si de verdad no hay nada; si la consulta falló y no
      // hay caché, es ERROR con reintento (no el falso "no tiene mantenimientos").
      this.fallo.set(res.failed && res.items.length === 0);
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
