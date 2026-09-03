import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { MiOrdenCompra, Solicitud, requisicionCodigo } from '../../../core/models/inventario.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** Track my material requests: Enviada → Aprobada → Entregada. */
@Component({
  selector: 'app-mis-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
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

  // BH1 — las canceladas (a menudo pruebas) no deben parecer trabajo pendiente:
  // ocultas por defecto, con un toggle para verlas.
  mostrarCanceladas = signal(false);
  canceladasCount = computed(() => this.solicitudes().filter((s) => s.estado === 'cancelada').length);
  visibles = computed(() =>
    this.mostrarCanceladas() ? this.solicitudes() : this.solicitudes().filter((s) => s.estado !== 'cancelada'),
  );
  toggleCanceladas(): void {
    this.mostrarCanceladas.update((v) => !v);
  }

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
