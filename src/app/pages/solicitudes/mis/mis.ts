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
  grupoRequisicion,
  necesidadInfo,
  necesidadOrden,
  GRUPO_ORDEN,
  GRUPO_LABEL,
  RequisicionGrupo,
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

  // BY3 — dos grupos: Activas (pendiente+en_proceso) e Historial (completada/rechazada).
  // Las completadas salen de arriba y van al Historial. Arranca en Activas (lo que
  // tiene trabajo pendiente); la preferencia se recuerda por dispositivo.
  private static readonly TAB_KEY = 'requis_tab_mis';
  readonly GRUPOS = GRUPO_ORDEN;
  grupoLabel = (g: RequisicionGrupo): string => GRUPO_LABEL[g];
  tab = signal<RequisicionGrupo>(
    (localStorage.getItem(MisSolicitudesPage.TAB_KEY) as RequisicionGrupo) || 'activas',
  );
  setTab(g: RequisicionGrupo): void {
    this.tab.set(g);
    try {
      localStorage.setItem(MisSolicitudesPage.TAB_KEY, g);
    } catch {
      /* best-effort: si no hay storage, solo no se recuerda */
    }
  }
  private readonly hoyISO = fechaLocalISO();
  grupoDe = (s: Solicitud): RequisicionGrupo => grupoRequisicion(s.estado, s.fase);
  /** BV10 — info de la fecha de necesidad de una requisición (para la 1ª línea). */
  necesidad = (s: Solicitud): NecesidadInfo => necesidadInfo(s.fecha_necesidad, this.hoyISO);
  /** Conteo por grupo (para los badges de las tabs). */
  conteos = computed<Record<RequisicionGrupo, number>>(() => {
    const c: Record<RequisicionGrupo, number> = { activas: 0, historial: 0 };
    for (const s of this.solicitudes()) c[this.grupoDe(s)]++;
    return c;
  });
  // BY3 — el grupo elegido, ordenado: Activas por entrega más cercana (necesidad asc,
  // vencidas arriba, sin fecha al final); Historial por cierre más reciente (created_at
  // desc como proxy — la lista no expone `cerrada_en`).
  visibles = computed(() => {
    const g = this.tab();
    const rows = this.solicitudes().filter((s) => this.grupoDe(s) === g);
    if (g === 'activas') {
      return rows.sort((a, b) => necesidadOrden(a.fecha_necesidad) - necesidadOrden(b.fecha_necesidad));
    }
    return rows.sort((a, b) => (Date.parse(b.created_at ?? '') || 0) - (Date.parse(a.created_at ?? '') || 0));
  });

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
