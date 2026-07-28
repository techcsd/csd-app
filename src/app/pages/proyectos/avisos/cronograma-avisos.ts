import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { CronogramaService } from '../../../core/services/cronograma.service';
import { NetworkService } from '../../../core/services/network.service';
import { CronogramaAviso, CRONOGRAMA_AVISO_LABEL } from '../../../core/models/cronograma.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/**
 * Y15 (FASE 5) — bandeja in-app de avisos de cronograma (por iniciar/vencer/
 * atrasada). Deep-link a la tarea en el cronograma del proyecto. La app NO tiene
 * push ni realtime (gap documentado); esta bandeja + el badge del tile de
 * Proyectos surten los avisos del servidor.
 */
@Component({
  selector: 'app-cronograma-avisos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './cronograma-avisos.html',
  styleUrl: './cronograma-avisos.scss',
})
export class CronogramaAvisosPage {
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  readonly tipoLabel = CRONOGRAMA_AVISO_LABEL;

  avisos = signal<CronogramaAviso[]>([]);
  loading = signal(true);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.avisos.set(await this.cronograma.getAvisos());
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  fmt(iso: string): string {
    return formatFechaMedia(iso);
  }

  abrir(a: CronogramaAviso): void {
    void this.router.navigate(['/proyectos', a.proyecto_id, 'cronograma'], {
      queryParams: a.referencia_id ? { tarea: a.referencia_id } : {},
    });
  }

  back(): void {
    this.location.back();
  }
}
