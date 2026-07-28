import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { ProyectosService } from '../../core/services/proyectos.service';
import { CronogramaService } from '../../core/services/cronograma.service';
import { NetworkService } from '../../core/services/network.service';
import { ProyectoApp, PROYECTO_ESTADO_LABEL, progresoProyecto } from '../../core/models/proyecto.model';

/**
 * Y14 — Módulo Proyectos en la app: listado de proyectos visibles (la RLS scopea
 * según rol). Online-first con cache; si no hay señal muestra lo cacheado + un
 * banner. Tap en un proyecto → detalle (fases + acceso al cronograma).
 */
@Component({
  selector: 'app-proyectos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './proyectos.html',
  styleUrl: './proyectos.scss',
})
export class ProyectosPage {
  private proyectos = inject(ProyectosService);
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private router = inject(Router);
  private location = inject(Location);

  readonly estadoLabel = PROYECTO_ESTADO_LABEL;

  lista = signal<ProyectoApp[]>([]);
  loading = signal(true);
  query = signal('');
  avisosCount = signal(0); // Y15 (FASE 5)

  filtrados = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.lista();
    return this.lista().filter(
      (p) => p.nombre.toLowerCase().includes(q) || (p.codigo ?? '').toLowerCase().includes(q) || (p.cliente ?? '').toLowerCase().includes(q),
    );
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.lista.set(await this.proyectos.getProyectos());
    } finally {
      this.loading.set(false);
    }
    // Y15 — conteo de avisos de cronograma (best-effort, online).
    void this.cronograma.getAvisos().then((a) => this.avisosCount.set(a.length)).catch(() => {});
  }

  verAvisos(): void {
    void this.router.navigate(['/proyectos/avisos']);
  }

  get online(): boolean {
    return this.network.online();
  }

  progreso(p: ProyectoApp): number | null {
    return progresoProyecto(p.fases);
  }

  abrir(p: ProyectoApp): void {
    void this.router.navigate(['/proyectos', p.id]);
  }

  back(): void {
    this.location.back();
  }
}
