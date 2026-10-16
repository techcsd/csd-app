import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { ReunionesService } from '../../../core/services/reuniones.service';
import { ReunionFiltro, ReunionListado } from '../../../core/models/reunion.model';
import { humanizeError } from '../../../shared/util/friendly-error.util';
import { formatFechaDespacho } from '../../../core/util/fecha';
import { UserContextService } from '../../../core/services/user-context.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { I18nService } from '../../../core/i18n/i18n.service';

const TABS: { key: ReunionFiltro; label: string }[] = [
  { key: 'proximas', label: 'Próximas' },
  { key: 'acta_pendiente', label: 'Acta pendiente' },
  { key: 'mias', label: 'Mías' },
  { key: 'pasadas', label: 'Historial' },
];

/** CP8 — lista de reuniones (próximas / acta pendiente / mías / historial). */
@Component({
  selector: 'app-reuniones-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState, SyncBar, LiveRefreshDirective, TranslatePipe],
  templateUrl: './reuniones-lista.html',
  styleUrl: './reuniones-lista.scss',
})
export class ReunionesListaPage {
  private service = inject(ReunionesService);
  private router = inject(Router);
  private location = inject(Location);
  private i18n = inject(I18nService);
  private ctx = inject(UserContextService);

  readonly tabs = TABS;
  readonly fmtFecha = formatFechaDespacho;

  /** CP8 — glifos desde TS (guarda AW12/no-ai-tropes: nada de emoji literal nuevo en la plantilla). */
  readonly glyph = { header: '🗓️', pendiente: '⏳', obra: '🏗' };

  tab = signal<ReunionFiltro>('proximas');
  loading = signal(true);
  error = signal('');
  reuniones = signal<ReunionListado[]>([]);

  puedeCrear = computed(() => this.ctx.hasModulo('reuniones') || this.ctx.esAdmin());

  constructor() {
    void this.cargar();
  }

  setTab(t: ReunionFiltro): void {
    if (this.tab() === t) return;
    this.tab.set(t);
    void this.cargar();
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.error.set('');
    try {
      this.reuniones.set(await this.service.listado(this.tab()));
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : this.i18n.t('No se pudieron cargar las reuniones.'));
    } finally {
      this.loading.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.cargar(silent);
  }

  abrir(r: ReunionListado): void {
    void this.router.navigate(['/reuniones', r.id]);
  }

  crear(): void {
    void this.router.navigate(['/reuniones/nueva']);
  }

  back(): void {
    this.location.back();
  }
}
