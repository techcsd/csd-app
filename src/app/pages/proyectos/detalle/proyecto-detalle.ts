import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ProyectosService } from '../../../core/services/proyectos.service';
import { NetworkService } from '../../../core/services/network.service';
import {
  ProyectoApp,
  FaseProyecto,
  PROYECTO_ESTADO_LABEL,
  FASE_ESTADO_LABEL,
  progresoProyecto,
} from '../../../core/models/proyecto.model';
import { formatFecha } from '../../../core/util/fecha';

/** Y14 — detalle de un proyecto: datos generales, fases y acceso al cronograma. */
@Component({
  selector: 'app-proyecto-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, EmptyState],
  templateUrl: './proyecto-detalle.html',
  styleUrl: './proyecto-detalle.scss',
})
export class ProyectoDetallePage {
  private proyectos = inject(ProyectosService);
  private network = inject(NetworkService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  readonly estadoLabel = PROYECTO_ESTADO_LABEL;
  readonly faseEstadoLabel = FASE_ESTADO_LABEL;

  private id = this.route.snapshot.paramMap.get('id') ?? '';
  proyecto = signal<ProyectoApp | null>(null);
  loading = signal(true);

  progreso = computed(() => {
    const p = this.proyecto();
    return p ? progresoProyecto(p.fases) : null;
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.proyecto.set(await this.proyectos.getProyecto(this.id));
    } finally {
      this.loading.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  fmt(iso: string | null): string {
    return iso ? formatFecha(iso) : '—';
  }

  cronograma(): void {
    void this.router.navigate(['/proyectos', this.id, 'cronograma']);
  }

  trackFase = (_: number, f: FaseProyecto) => f.id;

  back(): void {
    this.location.back();
  }
}
