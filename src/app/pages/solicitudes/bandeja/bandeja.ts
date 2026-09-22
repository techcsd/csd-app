import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import {
  RequisicionBandeja,
  faseRequisicion,
  necesidadInfo,
  necesidadOrden,
  FASE_ORDEN,
  FASE_LABEL,
  RequisicionFase,
  NecesidadInfo,
} from '../../../core/models/inventario.model';
import { formatFechaMedia, fechaLocalISO } from '../../../core/util/fecha';

/** AS7 — Bandeja de TODAS las requisiciones para roles con función de requisición:
 *  filtro por estado/urgencia + búsqueda, fila → detalle. Solo lectura (v1); la
 *  gestión (aprobar/rechazar) usa el flujo de la web por ahora. */
@Component({
  selector: 'app-requisiciones-bandeja',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe],
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
  urgencia = signal<string | null>(null);
  busqueda = signal('');
  noAutorizado = signal(false);

  // BV9 — tabs por fase (client-side sobre TODAS las cargadas). Arranca en Pendientes.
  readonly FASES = FASE_ORDEN;
  faseLabel = (f: RequisicionFase): string => FASE_LABEL[f];
  tab = signal<RequisicionFase>('pendiente');
  setTab(f: RequisicionFase): void {
    this.tab.set(f);
  }
  private readonly hoyISO = fechaLocalISO();
  faseDe = (f: RequisicionBandeja): RequisicionFase => faseRequisicion(f.estado, f.fase);
  necesidad = (f: RequisicionBandeja): NecesidadInfo => necesidadInfo(f.fecha_necesidad, this.hoyISO);

  conteos = computed<Record<RequisicionFase, number>>(() => {
    const c: Record<RequisicionFase, number> = { pendiente: 0, en_proceso: 0, completada: 0, rechazada: 0 };
    for (const f of this.filas()) c[this.faseDe(f)]++;
    return c;
  });

  // BV10 — la fase elegida, ORDENADA por fecha de necesidad (sin fecha al final).
  filasVisibles = computed(() =>
    this.filas()
      .filter((f) => this.faseDe(f) === this.tab())
      .sort((a, b) => necesidadOrden(a.fecha_necesidad) - necesidadOrden(b.fecha_necesidad)),
  );

  private debounce: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      // BV9 — carga TODAS (sin filtro server de estado) para poder tabular por fase en
      // cliente; urgencia/búsqueda siguen filtrando en el server.
      const filas = await this.service.bandeja({
        estado: null,
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
      case 'por_despachar': return 'Por despachar';
      case 'entregada': return 'Entregada';
      case 'completada':
      case 'cerrada': return 'Completada';
      case 'rechazada': return 'Rechazada';
      case 'cancelada': return 'Cancelada';
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
