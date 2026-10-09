import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ApoyoService, ApoyoListadoRow, TipoApoyo, EstadoApoyo } from '../../../core/services/apoyo.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { formatFecha } from '../../../core/util/fecha';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

const TIPO_LABEL: Record<TipoApoyo, string> = {
  movimiento_interno: 'Movimiento interno',
  retiro_material: 'Retiro de material',
  bote: 'Bote',
};
const ESTADO_LABEL: Record<EstadoApoyo, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_proceso: 'En proceso',
  por_confirmar: 'Por confirmar',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

/**
 * CK12 — listado de "Apoyo de transporte". El ingeniero ve los suyos (RLS); el
 * referente ve todos. Chips de tipo/estado, miniatura de foto y día. Sin prioridad
 * (CK11). Toque en una fila → ficha con la línea de tiempo y los botones de estado.
 */
@Component({
  selector: 'app-apoyo-listado',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, LiveRefreshDirective, TranslatePipe],
  templateUrl: './apoyo-listado.html',
  styleUrl: './apoyo-listado.scss',
})
export class ApoyoListadoPage {
  private apoyo = inject(ApoyoService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private i18n = inject(I18nService);

  fmtFecha = formatFecha;
  tipoLabel = (t: TipoApoyo) => TIPO_LABEL[t] ?? t;
  estadoLabel = (e: EstadoApoyo) => ESTADO_LABEL[e] ?? e;

  loading = signal(true);
  refrescando = signal(false);
  lista = signal<ApoyoListadoRow[]>([]);

  filtroTipo = signal<TipoApoyo | ''>('');
  filtroEstado = signal<EstadoApoyo | ''>('');

  readonly tipos: TipoApoyo[] = ['movimiento_interno', 'retiro_material', 'bote'];
  readonly estados: EstadoApoyo[] = ['pendiente', 'asignada', 'en_proceso', 'por_confirmar', 'completada', 'cancelada'];

  constructor() {
    void this.load();
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.lista.set(
        await this.apoyo.listar({
          tipo: this.filtroTipo() || null,
          estado: this.filtroEstado() || null,
        }),
      );
    } catch {
      this.toast.error(this.i18n.t('No pudimos cargar los apoyos.'));
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  aplicarFiltroTipo(t: TipoApoyo | ''): void {
    this.filtroTipo.set(t);
    void this.load(true);
  }
  aplicarFiltroEstado(e: EstadoApoyo | ''): void {
    this.filtroEstado.set(e);
    void this.load(true);
  }

  crear(): void {
    void this.router.navigate(['/transporte/apoyo/nuevo']);
  }

  abrir(row: ApoyoListadoRow): void {
    if (row.pendiente) {
      this.toast.show(this.i18n.t('Este apoyo aún se está enviando.'), 'info');
      return;
    }
    void this.router.navigate(['/transporte/apoyo', row.id]);
  }

  back(): void {
    this.navGuard.back('/transporte');
  }
}
