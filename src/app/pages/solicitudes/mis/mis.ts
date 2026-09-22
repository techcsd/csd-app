import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import {
  MiOrdenCompra,
  Solicitud,
  requisicionCodigo,
  faseRequisicion,
  necesidadInfo,
  necesidadOrden,
  FASE_ORDEN,
  FASE_LABEL,
  RequisicionFase,
  NecesidadInfo,
} from '../../../core/models/inventario.model';
import { formatFechaMedia, fechaLocalISO } from '../../../core/util/fecha';

/** Track my material requests: Enviada → Aprobada → Entregada. */
@Component({
  selector: 'app-mis-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, TranslatePipe],
  templateUrl: './mis.html',
  styleUrl: './mis.scss',
})
export class MisSolicitudesPage {
  private service = inject(SolicitudesService);
  private router = inject(Router);
  private location = inject(Location);

  codigo = requisicionCodigo; // BC4 — REQ-XXXXXX

  nueva(): void {
    void this.router.navigate(['/solicitudes/pedir']);
  }

  /** BC1 — abre el detalle completo de la requisición tocada. */
  abrir(s: Solicitud): void {
    void this.router.navigate(['/solicitudes/requisicion', s.id]);
  }

  solicitudes = signal<Solicitud[]>([]);
  // AY3 (follow-up) — órdenes de compra nacidas de mis requisiciones, keyed por solicitud.
  private ordenes = signal<Map<string, MiOrdenCompra>>(new Map());
  loading = signal(true);
  fmtFecha = formatFechaMedia; // U9

  // BV9 — tabs por fase (pendiente/en_proceso/completada/rechazada). Arranca en la
  // fase con trabajo activo (pendiente) para no esconder lo urgente.
  readonly FASES = FASE_ORDEN;
  faseLabel = (f: RequisicionFase): string => FASE_LABEL[f];
  tab = signal<RequisicionFase>('pendiente');
  setTab(f: RequisicionFase): void {
    this.tab.set(f);
  }
  private readonly hoyISO = fechaLocalISO();
  faseDe = (s: Solicitud): RequisicionFase => faseRequisicion(s.estado, s.fase);
  /** BV10 — info de la fecha de necesidad de una requisición (para la 1ª línea). */
  necesidad = (s: Solicitud): NecesidadInfo => necesidadInfo(s.fecha_necesidad, this.hoyISO);
  /** Conteo por fase (para los badges de las tabs). */
  conteos = computed<Record<RequisicionFase, number>>(() => {
    const c: Record<RequisicionFase, number> = { pendiente: 0, en_proceso: 0, completada: 0, rechazada: 0 };
    for (const s of this.solicitudes()) c[this.faseDe(s)]++;
    return c;
  });
  // BV10 — la fase elegida, ORDENADA por fecha de necesidad (sin fecha al final).
  visibles = computed(() =>
    this.solicitudes()
      .filter((s) => this.faseDe(s) === this.tab())
      .sort((a, b) => necesidadOrden(a.fecha_necesidad) - necesidadOrden(b.fecha_necesidad)),
  );

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.solicitudes.set(await this.service.misSolicitudes());
    } finally {
      this.loading.set(false);
    }
    // AY3 — el avance de la orden es un extra best-effort: no bloquea la lista ni
    // rompe si el RPC falla / estás offline (se degrada a solo el estado de la requis).
    try {
      const rows = await this.service.misOrdenesDeCompra();
      this.ordenes.set(new Map(rows.map((o) => [o.solicitud_id, o])));
    } catch {
      /* best-effort */
    }
  }

  /** AY3 — orden de compra asociada a una requisición (o null si aún no generó una). */
  ordenDe(solicitudId: string): MiOrdenCompra | null {
    return this.ordenes().get(solicitudId) ?? null;
  }

  /** Etiqueta legible del estado de la orden de compra (fallback al valor crudo). */
  ordenEstadoLabel(e: string): string {
    switch (e) {
      case 'borrador':
        return 'En preparación';
      case 'pendiente':
        return 'Pendiente';
      case 'aprobada':
        return 'Aprobada';
      case 'recibida':
        return 'Recibida';
      case 'cancelada':
        return 'Cancelada';
      default:
        return e;
    }
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente':
        return 'Enviada';
      case 'aprobada':
        return 'Aprobada';
      case 'por_despachar':
        return 'Por despachar';
      case 'entregada':
        return 'Recibida';
      case 'completada':
      case 'cerrada':
        return 'Completada';
      case 'rechazada':
        return 'Rechazada';
      case 'cancelada':
        return 'Cancelada';
      default:
        return e;
    }
  }

  back(): void {
    this.location.back();
  }
}
