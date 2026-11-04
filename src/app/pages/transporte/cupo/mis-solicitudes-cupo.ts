import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { CupoTarjetaService } from '../../../core/services/cupo-tarjeta.service';
import { ToastService } from '../../../core/services/toast.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { EstadoSolicitudCupo, SolicitudCupo } from '../../../core/models/cupo-tarjeta.model';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

/** Emoji + etiqueta por estado (regla de UI: nunca depender solo del color). */
const ESTADO_LABEL: Record<EstadoSolicitudCupo, string> = {
  pendiente: '🟡 Pendiente',
  ampliada: '🟢 Ampliada',
  rechazada: '🔴 Rechazada',
  cancelada: '⚪ Cancelada',
};

/**
 * DI — "Mis solicitudes" de cupo de tarjeta (RPC mis_solicitudes_cupo).
 * Paginado por lotes (DI8, mismo patrón de combustible-log).
 */
@Component({
  selector: 'app-mis-solicitudes-cupo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, ConfirmDialog, WizardExit, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './mis-solicitudes-cupo.html',
  styleUrl: './mis-solicitudes-cupo.scss',
})
export class MisSolicitudesCupoPage {
  private cupoTarjeta = inject(CupoTarjetaService);
  private toast = inject(ToastService);
  private i18n = inject(I18nService);
  private location = inject(Location);
  private router = inject(Router);

  readonly fechaHora = formatFechaCortaHora;
  readonly estadoLabel = ESTADO_LABEL;

  // DI8 — paginación por lotes (ninguna lista sin paginar).
  private readonly LOTE = 30;
  visibleCount = signal(this.LOTE);

  loading = signal(true);
  rows = signal<SolicitudCupo[]>([]);
  cancelandoId = signal<string | null>(null);

  visibles = computed(() => this.rows().slice(0, this.visibleCount()));
  hayMas = computed(() => this.rows().length > this.visibleCount());
  cargarMas(): void {
    this.visibleCount.update((n) => n + this.LOTE);
  }

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const list = await this.cupoTarjeta.misSolicitudes();
      this.rows.set(list);
      this.visibleCount.set(this.LOTE);
    } catch {
      this.toast.error(this.i18n.t('No se pudieron cargar tus solicitudes.'));
    } finally {
      this.loading.set(false);
    }
  }

  pedirCancelar(id: string): void {
    this.cancelandoId.set(id);
  }

  cerrarConfirmCancelar(): void {
    this.cancelandoId.set(null);
  }

  async confirmarCancelar(): Promise<void> {
    const id = this.cancelandoId();
    this.cancelandoId.set(null);
    if (!id) return;
    try {
      await this.cupoTarjeta.cancelar(id);
      this.toast.success(this.i18n.t('Solicitud cancelada.'));
      await this.load();
    } catch {
      this.toast.error(this.i18n.t('No se pudo cancelar la solicitud.'));
    }
  }

  pedirMas(): void {
    void this.router.navigate(['/transporte/cupo/solicitar']);
  }

  back(): void {
    this.location.back();
  }
}
