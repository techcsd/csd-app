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

  // AT11 — declinar: item cuyo panel de motivos está abierto + envío en curso.
  declinandoId = signal<string | null>(null);
  enviandoDeclina = signal(false);
  readonly motivos = [
    'No es necesario crear el artículo',
    'Ya existe en el catálogo',
    'Duplicado',
  ];

  constructor() {
    void this.load();
  }

  /** AT11 — abre/cierra el panel de motivos de un item. */
  toggleDeclinar(id: string): void {
    this.declinandoId.set(this.declinandoId() === id ? null : id);
  }

  /** AT11 — declina un item con el motivo elegido (→ historial + aviso al reportero). */
  async declinar(item: MaterialNoCatalogado, motivo: string): Promise<void> {
    if (this.enviandoDeclina()) return;
    this.enviandoDeclina.set(true);
    try {
      await this.inventario.declinarItemLibre(item.id, motivo);
      this.toast.success('Material declinado. Se avisó a quien lo reportó.');
      this.declinandoId.set(null);
      await this.load(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo declinar.');
    } finally {
      this.enviandoDeclina.set(false);
    }
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
