import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { InventarioService } from '../../../core/services/inventario.service';
import { MaterialNoCatalogado } from '../../../core/models/inventario.model';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';

/**
 * AU4 — bandeja de material NO catalogado (regla AT11 — todo item libre es visible
 * para depurar el catálogo). Solo lectura en la app: el admin ve QUÉ materiales
 * fuera de catálogo se movieron y en qué conduce; crear/vincular el artículo se
 * hace desde la web SGC (el flujo de creación de artículos vive allá). El RPC gatea
 * por admin/inventario (a otros roles devuelve []).
 */
@Component({
  selector: 'app-material-no-catalogado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, LiveRefreshDirective],
  templateUrl: './material-no-catalogado.html',
  styleUrl: './material-no-catalogado.scss',
})
export class MaterialNoCatalogadoPage {
  private inventario = inject(InventarioService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  fmtFecha = formatFecha;

  loading = signal(true);
  refrescando = signal(false);
  incluirResueltos = signal(false);
  items = signal<MaterialNoCatalogado[]>([]);

  constructor() {
    void this.load();
  }

  private async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.items.set(await this.inventario.materialNoCatalogadoPendientes(this.incluirResueltos()));
    } catch {
      this.toast.error('No pudimos cargar los materiales no catalogados.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  toggleResueltos(): void {
    this.incluirResueltos.update((v) => !v);
    void this.load();
  }

  back(): void {
    this.navGuard.back('/home');
  }
}
