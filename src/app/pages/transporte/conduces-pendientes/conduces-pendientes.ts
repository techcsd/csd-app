import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConducesService, ConducePendienteEntrega } from '../../../core/services/conduces.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

/**
 * AI2 — "Pendiente entrega": conduces emitidos que faltan por entregar al receptor.
 * Cada uno se entrega (receptor + foto + firma) o se transfiere a otro chofer (AH5).
 */
@Component({
  selector: 'app-conduces-pendientes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect],
  templateUrl: './conduces-pendientes.html',
  styleUrl: './conduces-pendientes.scss',
})
export class ConducesPendientesPage {
  private conduces = inject(ConducesService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private navGuard = inject(NavGuardService);

  fmtFecha = formatFecha;

  loading = signal(true);
  pendientes = signal<ConducePendienteEntrega[]>([]);

  // AH5 — transferencia inline por fila.
  choferes = signal<{ id: string; label: string }[]>([]);
  choferOptions = computed(() => this.choferes());
  transfiriendoId = signal(''); // salida_id de la fila con el picker abierto
  transferConductor = signal('');
  transferNota = signal('');
  enviandoTransfer = signal(false);

  constructor() {
    void this.load();
    void this.conduces.choferesParaTransferir().then((l) => this.choferes.set(l)).catch(() => {});
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.pendientes.set(await this.conduces.misConducesPendientesEntrega());
    } catch {
      this.toast.error('No pudimos cargar los conduces pendientes.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Entregar: abre el flujo de entrega del conduce (receptor + foto + firma). */
  entregar(id: string): void {
    void this.router.navigate(['/transporte/conduces', id]);
  }

  // ── AH5 — transferir a otro chofer (inline) ────────────────────────────────
  abrirTransferir(id: string): void {
    this.transfiriendoId.set(this.transfiriendoId() === id ? '' : id);
    this.transferConductor.set('');
    this.transferNota.set('');
  }

  async confirmarTransferir(id: string): Promise<void> {
    if (!this.transferConductor()) {
      this.toast.error('Elige a quién transfieres el conduce.');
      return;
    }
    if (this.enviandoTransfer()) return;
    this.enviandoTransfer.set(true);
    try {
      await this.conduces.ofrecerTransferencia(id, this.transferConductor(), this.transferNota().trim() || null);
      this.toast.success('Transferencia ofrecida. El chofer debe aceptarla.');
      this.transfiriendoId.set('');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo transferir.');
    } finally {
      this.enviandoTransfer.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
