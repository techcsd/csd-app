import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { CartillaService } from '../../../core/services/cartilla.service';
import { CartillaEstado, CartillaListado } from '../../../shared/models/cartilla.model';
import { EstadoChip } from '../../../shared/ui/estado-chip/estado-chip';
import { TecTono } from '../../../shared/utils/tec-tono.util';
import { formatFecha } from '../../../core/util/fecha';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

const ESTADO_LABEL: Record<CartillaEstado, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  revisada: 'Revisada',
  observada: 'Observada',
  ejecutada: 'Ejecutada',
};
/** F8 — estado = punto + palabra + fondo suave (app-estado-chip, CB v2). */
const ESTADO_TONO: Record<CartillaEstado, TecTono> = {
  borrador: 'neutral',
  enviada: 'info',
  revisada: 'success',
  observada: 'warning',
  ejecutada: 'success',
};

/**
 * BO10 — "Mis cartillas": lista de las cartillas del ingeniero con su estado y kg.
 * Distingue "sin cartillas" de "no se pudo cargar" (BL2): un fallo ofrece reintento
 * en vez de afirmar que no hay nada.
 */
@Component({
  selector: 'app-cartillas-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, DecimalPipe, EstadoChip, TranslatePipe, ...MOTION_DIRECTIVES],
  templateUrl: './cartillas-lista.html',
  styleUrl: './cartillas-lista.scss',
})
export class CartillasListaPage {
  private service = inject(CartillaService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  error = signal(false);
  cartillas = signal<CartillaListado[]>([]);
  fmtFecha = formatFecha;
  q = signal('');

  // DI8 — paginación por lotes (regla de la casa): solo se pinta el lote visible.
  private readonly LOTE = 20;
  visibleCount = signal(this.LOTE);

  /** Filtro local por folio u obra. */
  filtradas = computed(() => {
    const q = this.q().trim().toLowerCase();
    const list = this.cartillas();
    if (!q) return list;
    return list.filter((c) =>
      [c.folio, c.proyecto].filter(Boolean).some((s) => s!.toLowerCase().includes(q)),
    );
  });

  visibles = computed(() => this.filtradas().slice(0, this.visibleCount()));
  hayMas = computed(() => this.filtradas().length > this.visibleCount());
  cargarMas(): void {
    this.visibleCount.update((n) => n + this.LOTE);
  }
  /** Reinicia el lote visible (nueva carga o nuevo filtro). */
  resetPag(): void {
    this.visibleCount.set(this.LOTE);
  }

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.cartillas.set(await this.service.misCartillas());
      this.resetPag(); // nueva carga arranca en el primer lote
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(e: CartillaEstado): string {
    return ESTADO_LABEL[e] ?? e;
  }
  estadoTono(e: CartillaEstado): TecTono {
    return ESTADO_TONO[e] ?? 'neutral';
  }

  nueva(): void {
    void this.router.navigate(['/ingenieria/cartilla/nueva']);
  }
  abrir(c: CartillaListado): void {
    void this.router.navigate(['/ingenieria/cartilla', c.id]);
  }
  back(): void {
    this.location.back();
  }
}
