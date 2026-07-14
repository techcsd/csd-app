import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ConductoresService } from '../../../core/services/conductores.service';
import { ConductorStats } from '../../../core/models/conductor.model';

/** Read-only driver profile: my flota activity/telemetry (R5). */
@Component({
  selector: 'app-mi-actividad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, Skeleton, EmptyState],
  templateUrl: './mi-actividad.html',
  styleUrl: './mi-actividad.scss',
})
export class MiActividadPage {
  private conductores = inject(ConductoresService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  stats = signal<ConductorStats | null>(null);
  esConductor = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const cond = await this.conductores.getMiConductor();
      this.esConductor.set(!!cond);
      if (cond) this.stats.set(await this.conductores.getMiStats());
    } finally {
      this.loading.set(false);
    }
  }

  irAsignar(): void {
    void this.router.navigate(['/transporte/asignar']);
  }

  back(): void {
    this.location.back();
  }
}
