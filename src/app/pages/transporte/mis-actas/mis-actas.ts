import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TraspasoService, ActaTraspaso } from '../../../core/services/traspaso.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFechaCortaHora } from '../../../core/util/fecha';

/**
 * AF36 — Historial de recepciones/traspasos de vehículo (actas). Muestra quién
 * dejó, quién recibió, km, condiciones y la llave 1. El chofer ve las suyas;
 * jefe de flota/admin ven todas (RLS + RPC mis_actas_traspaso).
 */
@Component({
  selector: 'app-mis-actas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState],
  templateUrl: './mis-actas.html',
  styleUrl: './mis-actas.scss',
})
export class MisActasPage {
  private traspaso = inject(TraspasoService);
  private ctx = inject(UserContextService);
  private toast = inject(ToastService);
  private location = inject(Location);

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
      this.toast.error('No se pudo cargar el historial de recepciones.');
    } finally {
      this.loading.set(false);
    }
  }

  /** ¿Yo recibí este vehículo (vs. yo lo entregué)? */
  yoRecibi(a: ActaTraspaso): boolean {
    return a.a_usuario_id === this.uid();
  }

  llaveLabel(t: string | null): string {
    switch (t) {
      case 'chofer_asignado': return '🧑‍✈️ Llave con el chofer';
      case 'oficina_central': return '🏢 Llave en oficina';
      case 'otro': return '📍 Llave en otro lugar';
      default: return '';
    }
  }

  back(): void {
    this.location.back();
  }
}
