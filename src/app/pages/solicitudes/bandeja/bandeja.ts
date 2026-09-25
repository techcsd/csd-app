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
  grupoRequisicion,
  necesidadInfo,
  necesidadOrden,
  GRUPO_ORDEN,
  GRUPO_LABEL,
  RequisicionGrupo,
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

  // BY3 — dos grupos (client-side sobre TODAS las cargadas): Activas / Historial.
  // Arranca en Activas; la preferencia se recuerda por dispositivo.
  private static readonly TAB_KEY = 'requis_tab_bandeja';
  readonly GRUPOS = GRUPO_ORDEN;
  grupoLabel = (g: RequisicionGrupo): string => GRUPO_LABEL[g];
  tab = signal<RequisicionGrupo>(
    (localStorage.getItem(RequisicionesBandejaPage.TAB_KEY) as RequisicionGrupo) || 'activas',
  );
  setTab(g: RequisicionGrupo): void {
    this.tab.set(g);
    try {
      localStorage.setItem(RequisicionesBandejaPage.TAB_KEY, g);
    } catch {
      /* best-effort */
    }
  }
  private readonly hoyISO = fechaLocalISO();
  grupoDe = (f: RequisicionBandeja): RequisicionGrupo => grupoRequisicion(f.estado, f.fase);
  necesidad = (f: RequisicionBandeja): NecesidadInfo => necesidadInfo(f.fecha_necesidad, this.hoyISO);

  conteos = computed<Record<RequisicionGrupo, number>>(() => {
    const c: Record<RequisicionGrupo, number> = { activas: 0, historial: 0 };
    for (const f of this.filas()) c[this.grupoDe(f)]++;
    return c;
  });

  // BY3 — el grupo elegido: Activas por entrega más cercana (necesidad asc); Historial
  // por cierre más reciente (created_at desc como proxy, la lista no expone cerrada_en).
  filasVisibles = computed(() => {
    const g = this.tab();
    const rows = this.filas().filter((f) => this.grupoDe(f) === g);
    if (g === 'activas') {
      return rows.sort((a, b) => necesidadOrden(a.fecha_necesidad) - necesidadOrden(b.fecha_necesidad));
    }
    return rows.sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0));
  });

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
