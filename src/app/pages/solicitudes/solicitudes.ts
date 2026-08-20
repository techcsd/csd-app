import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { SyncBar } from '../../shared/components/sync-bar/sync-bar';
import { SolicitudesService } from '../../core/services/solicitudes.service';

/** Solicitudes hub: pedir materiales, mis solicitudes, y (por rol) la bandeja de todas. */
@Component({
  selector: 'app-solicitudes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SyncBar],
  templateUrl: './solicitudes.html',
  styleUrl: './solicitudes.scss',
})
export class SolicitudesPage {
  private router = inject(Router);
  private location = inject(Location);
  private service = inject(SolicitudesService);

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
