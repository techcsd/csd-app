import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConducesService, ConduceDetalle } from '../../../core/services/conduces.service';
import { ConducePdfService } from '../../../core/services/conduce-pdf.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { NetworkService } from '../../../core/services/network.service';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

/** Etiquetas de fase del conduce (homologado con la web). */
const FASE_LABEL: Record<string, string> = {
  emitido: 'Emitido',
  en_transito: 'En ruta',
  entregando: 'Entregando',
  entregado: 'Entregado',
  entregado_incompleto: 'Entregado incompleto',
  pendiente_firma: 'Pendiente de firma',
  confirmado: 'Confirmado',
};

/**
 * AL9/AL13/AL4 — Detalle de un conduce (documento). Fuente única abierta desde
 * "Pendiente entrega", "Por confirmar", "Confirmaciones" e "Histórico". Refleja
 * SIEMPRE el portador y estado actual (arregla el render de fila vieja tras una
 * transferencia). Base visual del "Ver conduce" (PDF) de la FASE 2.
 */
@Component({
  selector: 'app-conduce-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState],
  templateUrl: './conduce-detalle.html',
  styleUrl: './conduce-detalle.scss',
})
export class ConduceDetallePage {
  private conduces = inject(ConducesService);
  private pdf = inject(ConducePdfService);
  private route = inject(ActivatedRoute);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private network = inject(NetworkService);

  fmtFecha = formatFecha;
  fmtFechaHora = formatFechaHumana;

  salidaId = this.route.snapshot.paramMap.get('salidaId') ?? '';
  loading = signal(true);
  detalle = signal<ConduceDetalle | null>(null);
  generando = signal(false);

  faseLabel = computed(() => {
    const d = this.detalle();
    if (!d) return '';
    return FASE_LABEL[d.fase ?? ''] ?? FASE_LABEL[d.estado ?? ''] ?? d.fase ?? d.estado ?? '—';
  });
  incompleto = computed(() => this.detalle()?.estado === 'entregado_incompleto');
  entregado = computed(() => {
    const e = this.detalle()?.estado ?? '';
    return e !== 'despachado' && e !== 'anulado';
  });
  destino = computed(() => {
    const d = this.detalle();
    return d?.proyecto || d?.destino_almacen || '—';
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.salidaId) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    try {
      this.detalle.set(await this.conduces.conduceDetalleApp(this.salidaId));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos cargar el conduce.');
    } finally {
      this.loading.set(false);
    }
  }

  /** AL4 — compartir el PDF (share sheet → WhatsApp). */
  async compartir(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para generar el PDF del conduce.');
      return;
    }
    if (this.generando()) return;
    this.generando.set(true);
    try {
      await this.pdf.compartir(d);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo compartir el conduce.');
    } finally {
      this.generando.set(false);
    }
  }

  /** AL4 — descargar el PDF al teléfono. */
  async descargar(): Promise<void> {
    const d = this.detalle();
    if (!d) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para generar el PDF del conduce.');
      return;
    }
    if (this.generando()) return;
    this.generando.set(true);
    try {
      const dest = await this.pdf.descargar(d);
      this.toast.success(`PDF guardado: ${dest}`);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo descargar el conduce.');
    } finally {
      this.generando.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
