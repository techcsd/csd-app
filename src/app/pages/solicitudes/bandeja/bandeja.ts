import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { RequisicionBandeja } from '../../../core/models/inventario.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** AS7 — Bandeja de TODAS las requisiciones para roles con función de requisición:
 *  filtro por estado/urgencia + búsqueda, fila → detalle. Solo lectura (v1); la
 *  gestión (aprobar/rechazar) usa el flujo de la web por ahora. */
@Component({
  selector: 'app-requisiciones-bandeja',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './bandeja.html',
  styleUrl: './bandeja.scss',
})
export class RequisicionesBandejaPage {
  private service = inject(SolicitudesService);
  private router = inject(Router);
  private location = inject(Location);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  filas = signal<RequisicionBandeja[]>([]);
  estado = signal<string | null>(null); // null = todas
  urgencia = signal<string | null>(null);
  busqueda = signal('');
  noAutorizado = signal(false);

  readonly estados = [
    { key: null, label: 'Todas' },
    { key: 'pendiente', label: 'Pendientes' },
    { key: 'aprobada', label: 'Aprobadas' },
    { key: 'entregada', label: 'Entregadas' },
    { key: 'rechazada', label: 'Rechazadas' },
    { key: 'cerrada', label: 'Cerradas' },
  ];

  pendientesCount = computed(() => this.filas().filter((f) => f.estado === 'pendiente').length);

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const filas = await this.service.bandeja({
        estado: this.estado(),
        urgencia: this.urgencia(),
        busqueda: this.busqueda().trim() || null,
      });
      this.filas.set(filas);
    } catch {
      this.noAutorizado.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  setEstado(e: string | null): void {
    this.estado.set(e);
    void this.cargar();
  }
  toggleUrgente(): void {
    this.urgencia.set(this.urgencia() === 'urgente' ? null : 'urgente');
    void this.cargar();
  }
  onBusqueda(v: string): void {
    this.busqueda.set(v);
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.cargar(), 350);
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente': return 'Pendiente';
      case 'aprobada': return 'Aprobada';
      case 'entregada': return 'Entregada';
      case 'cerrada': return 'Cerrada';
      case 'rechazada': return 'Rechazada';
      default: return e;
    }
  }

  abrir(f: RequisicionBandeja): void {
    void this.router.navigate(['/solicitudes/requisicion', f.id]);
  }

  back(): void {
    this.location.back();
  }
}
