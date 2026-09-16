import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CartillaService } from '../../../core/services/cartilla.service';
import { CartillaEstado, CartillaListado } from '../../../shared/models/cartilla.model';
import { formatFecha } from '../../../core/util/fecha';

const ESTADO_LABEL: Record<CartillaEstado, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  revisada: 'Revisada',
  observada: 'Observada',
  ejecutada: 'Ejecutada',
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
  imports: [Skeleton, EmptyState, DecimalPipe],
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

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      this.cartillas.set(await this.service.misCartillas());
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  estadoLabel(e: CartillaEstado): string {
    return ESTADO_LABEL[e] ?? e;
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
