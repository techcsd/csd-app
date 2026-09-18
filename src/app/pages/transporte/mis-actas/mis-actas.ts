import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TraspasoService, ActaTraspaso } from '../../../core/services/traspaso.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaCortaHora } from '../../../core/util/fecha';
import { I18nService } from '../../../core/i18n/i18n.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

/**
 * AF36 — Historial de recepciones/traspasos de vehículo (actas). Muestra quién
 * dejó, quién recibió, km, condiciones y la llave 1. El chofer ve las suyas;
 * jefe de flota/admin ven todas (RLS + RPC mis_actas_traspaso).
 */
@Component({
  selector: 'app-mis-actas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, TranslatePipe],
  templateUrl: './mis-actas.html',
  styleUrl: './mis-actas.scss',
})
export class MisActasPage {
  private traspaso = inject(TraspasoService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);
  private i18n = inject(I18nService);

  readonly fechaHora = formatFechaCortaHora;

  loading = signal(true);
  actas = signal<ActaTraspaso[]>([]);
  private uid = computed(() => this.ctx.profile()?.id ?? null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.actas.set(await this.traspaso.misActas());
    } catch {
      this.toast.error(this.i18n.t('No se pudo cargar el historial de recepciones.'));
    } finally {
      this.loading.set(false);
    }
  }

  /** ¿Yo recibí este vehículo (vs. yo lo entregué)? */
  yoRecibi(a: ActaTraspaso): boolean {
    return a.a_usuario_id === this.uid();
  }

  /** AH14 — marca + modelo (además de la placa) para reconocer el vehículo. */
  marcaModelo(a: ActaTraspaso): string {
    return [a.marca, a.modelo].filter(Boolean).join(' ');
  }

  /** AH14 — abrir el detalle completo del acta. */
  abrir(a: ActaTraspaso): void {
    void this.router.navigate(['/transporte/acta', a.id]);
  }

  llaveLabel(t: string | null): string {
    switch (t) {
      case 'chofer_asignado': return '🧑‍✈️ ' + this.i18n.t('Llave con el chofer');
      case 'oficina_central': return '🏢 ' + this.i18n.t('Llave en oficina');
      case 'otro': return '📍 ' + this.i18n.t('Llave en otro lugar');
      default: return '';
    }
  }

  back(): void {
    this.location.back();
  }
}
