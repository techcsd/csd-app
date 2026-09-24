import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SolicitudesService } from '../../core/services/solicitudes.service';
import { UserContextService } from '../../core/services/user-context.service';

/** Solicitudes hub: pedir materiales, mis solicitudes, y (por rol) la bandeja de todas. */
@Component({
  selector: 'app-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar, TranslatePipe],
  templateUrl: './solicitudes.html',
  styleUrl: './solicitudes.scss',
})
export class SolicitudesPage {
  private router = inject(Router);
  private location = inject(Location);
  private service = inject(SolicitudesService);
  private ctx = inject(UserContextService);

  // BX1/AU8 — "Nueva requisición" es ESCRITURA: la ruta /solicitudes/pedir exige
  // `compras.solicitudes:operar`. No se pinta a quien solo tiene LECTURA del submódulo
  // (p. ej. el rol Developer, es_operativo=false, con `ver`). El menú y el guard leen
  // la misma matriz: nada visible que dé 403 (regla 4). El servidor la rechaza igual.
  puedeCrear = computed(() => this.ctx.puedeOperarSubmodulo('compras.solicitudes'));

  // AS7 — la bandeja de "todas" solo se ofrece a los roles con función de requisición.
  puedeVerTodas = signal(false);
  pendientes = signal(0);

  constructor() {
    void this.initBandeja();
  }

  private async initBandeja(): Promise<void> {
    if (await this.service.puedeVerTodas()) {
      this.puedeVerTodas.set(true);
      this.pendientes.set(await this.service.bandejaCount());
    }
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }
  back(): void {
    this.location.back();
  }
}
