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
  GRUPO_ORDEN,
  GRUPO_LABEL,
  RequisicionGrupo,
  NecesidadInfo,
  OrdenClave,
  OrdenRequisicion,
  compararPorOrden,
} from '../../../core/models/inventario.model';
import { formatFechaMedia, fechaLocalISO } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** AS7 — Bandeja de TODAS las requisiciones para roles con función de requisición:
 *  filtro por estado/urgencia + búsqueda, fila → detalle. Solo lectura (v1); la
 *  gestión (aprobar/rechazar) usa el flujo de la web por ahora. */
@Component({
  selector: 'app-requisiciones-bandeja',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, TranslatePipe, ...MOTION_DIRECTIVES],
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

  // CS1 — orden elegible de Activas (Fecha/Necesidad ▲▼), recordado por dispositivo.
  // Historial sigue fijo por cierre (no es elegible, mismo criterio de siempre).
  private static readonly ORDEN_KEY = 'requis_orden_bandeja';
  orden = signal<OrdenRequisicion>(this.leerOrdenGuardado());
  private leerOrdenGuardado(): OrdenRequisicion {
    try {
      const raw = localStorage.getItem(RequisicionesBandejaPage.ORDEN_KEY);
      if (raw) {
        const v = JSON.parse(raw) as OrdenRequisicion;
        if ((v.clave === 'fecha' || v.clave === 'necesidad') && (v.direccion === 'asc' || v.direccion === 'desc')) return v;
      }
    } catch {
      /* best-effort */
    }
    return { clave: 'necesidad', direccion: 'asc' };
  }
  /** Toca la misma clave → alterna dirección; toca la otra → cambia de clave (con un
   *  default de dirección sensato: necesidad asc = más próxima primero, fecha desc = más
   *  reciente primero). */
  setOrden(clave: OrdenClave): void {
    this.orden.update((cur) => {
      const next: OrdenRequisicion =
        cur.clave === clave
          ? { clave, direccion: cur.direccion === 'asc' ? 'desc' : 'asc' }
          : { clave, direccion: clave === 'necesidad' ? 'asc' : 'desc' };
      try {
        localStorage.setItem(RequisicionesBandejaPage.ORDEN_KEY, JSON.stringify(next));
      } catch {
        /* best-effort */
      }
      return next;
    });
  }

  conteos = computed<Record<RequisicionGrupo, number>>(() => {
    const c: Record<RequisicionGrupo, number> = { activas: 0, historial: 0 };
    for (const f of this.filas()) c[this.grupoDe(f)]++;
    return c;
  });

  // BY3/BZ0 — el grupo elegido: Activas por el orden elegido (CS1, default necesidad asc);
  // Historial por cierre más reciente (cerrada_en, ya expuesto por requisiciones_bandeja;
  // created_at de respaldo para filas viejas sin cierre).
  filasVisibles = computed(() => {
    const g = this.tab();
    const rows = this.filas().filter((f) => this.grupoDe(f) === g);
    if (g === 'activas') {
      const o = this.orden();
      return rows.sort((a, b) => compararPorOrden(a, b, o));
    }
    return rows.sort((a, b) => (Date.parse(b.cerrada_en ?? b.created_at ?? '') || 0) - (Date.parse(a.cerrada_en ?? a.created_at ?? '') || 0));
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
