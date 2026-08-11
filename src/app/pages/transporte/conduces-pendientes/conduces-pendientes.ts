import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConducesService, ConducePendienteEntrega } from '../../../core/services/conduces.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

/**
 * AI2 — "Pendiente entrega": conduces emitidos que faltan por entregar al receptor.
 * Cada uno se entrega (receptor + foto + firma) o se transfiere a otro chofer (AH5).
 *
 * AL13 — refresh: la lista se re-consulta al volver a primer plano (resume nativo
 * + visibilitychange PWA), con botón "Actualizar" y pull-to-refresh. Así, cuando el
 * receptor acepta una transferencia, el emisor ve desaparecer el conduce al instante
 * (el RPC ya está anclado al portador actual; basta re-leer). AL9 — cada fila abre
 * el detalle del conduce (items/firmas/fotos/estado actual).
 */
@Component({
  selector: 'app-conduces-pendientes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, CollapsibleSelect],
  templateUrl: './conduces-pendientes.html',
  styleUrl: './conduces-pendientes.scss',
})
export class ConducesPendientesPage implements OnDestroy {
  private conduces = inject(ConducesService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private navGuard = inject(NavGuardService);

  fmtFecha = formatFecha;
  // AK7 — fecha + hora exacta de emisión (created_at), 12h homologado.
  fmtFechaHora = formatFechaHumana;

  loading = signal(true);
  refrescando = signal(false);
  pendientes = signal<ConducePendienteEntrega[]>([]);

  // AL13 — pull-to-refresh (indicador visual).
  pullY = signal(0);
  private pullStartY = 0;
  private pullActive = false;

  // AH5 — transferencia inline por fila.
  choferes = signal<{ id: string; label: string }[]>([]);
  choferOptions = computed(() => this.choferes());
  transfiriendoId = signal(''); // salida_id de la fila con el picker abierto
  transferConductor = signal('');
  transferNota = signal('');
  enviandoTransfer = signal(false);

  private resumeHandle: PluginListenerHandle | null = null;
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') void this.load(true);
  };

  constructor() {
    void this.load();
    void this.conduces.choferesParaTransferir().then((l) => this.choferes.set(l)).catch(() => {});

    // AL13 — refrescar al volver a primer plano.
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('resume', () => void this.load(true)).then((h) => (this.resumeHandle = h));
    }
    document.addEventListener('visibilitychange', this.onVisible);
  }

  ngOnDestroy(): void {
    void this.resumeHandle?.remove();
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.pendientes.set(await this.conduces.misConducesPendientesEntrega());
    } catch {
      if (!silent) this.toast.error('No pudimos cargar los conduces pendientes.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AL13 — botón "Actualizar". */
  refrescar(): void {
    void this.load(true);
  }

  /** AL9 — abrir el detalle del conduce (fuera de los botones de acción). */
  verDetalle(id: string): void {
    void this.router.navigate(['/transporte/conduce-detalle', id]);
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
      await this.load(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo transferir.');
    } finally {
      this.enviandoTransfer.set(false);
    }
  }

  // ── AL13 — pull-to-refresh (gesto simple: arrastrar hacia abajo estando arriba) ─
  onPullStart(ev: TouchEvent, body: HTMLElement): void {
    this.pullActive = body.scrollTop <= 0;
    this.pullStartY = ev.touches[0]?.clientY ?? 0;
  }
  onPullMove(ev: TouchEvent): void {
    if (!this.pullActive) return;
    const dy = (ev.touches[0]?.clientY ?? 0) - this.pullStartY;
    if (dy > 0) this.pullY.set(Math.min(dy * 0.5, 80));
  }
  onPullEnd(): void {
    if (this.pullY() > 60) this.refrescar();
    this.pullY.set(0);
    this.pullActive = false;
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub'); // QA-15 — back seguro
  }
}
