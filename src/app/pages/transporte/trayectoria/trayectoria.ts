import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { TrayectoriaMap } from '../../../shared/ui/trayectoria-map/trayectoria-map';
import { RecorridoService, RutaTrayecto } from '../../../core/services/recorrido.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';

/**
 * AU5 — "Ver trayectoria" de UNA ruta (replay estático del recorrido). Se abre al
 * completar una ruta (pantalla de éxito) y desde el detalle de rutas finalizadas.
 * Consume ruta_trayecto(ruta_id) (contrato AJ14/AU5 ya desplegado).
 */
@Component({
  selector: 'app-trayectoria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton, EmptyState, TrayectoriaMap],
  templateUrl: './trayectoria.html',
  styleUrl: './trayectoria.scss',
})
export class TrayectoriaPage {
  private route = inject(ActivatedRoute);
  private recorrido = inject(RecorridoService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  loading = signal(true);
  data = signal<RutaTrayecto | null>(null);
  coords = computed<[number, number][]>(() => this.data()?.coords ?? []);
  tienePuntos = computed(() => this.coords().length > 0);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const id = this.route.snapshot.paramMap.get('rutaId');
      if (!id) return;
      this.data.set(await this.recorrido.rutaTrayecto(id));
    } catch {
      this.toast.error('No pudimos cargar la trayectoria.');
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
