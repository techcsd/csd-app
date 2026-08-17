import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../shared/ui/live-refresh/live-refresh.directive';
import { ProyectosService } from '../../core/services/proyectos.service';
import { CronogramaService } from '../../core/services/cronograma.service';
import { NetworkService } from '../../core/services/network.service';
import { UserContextService } from '../../core/services/user-context.service';
import { ProyectoApp, PROYECTO_ESTADO_LABEL, progresoProyecto, zonaDeProyecto } from '../../core/models/proyecto.model';
import { CollapsibleSelect } from '../../shared/ui/collapsible-select/collapsible-select';

/**
 * Y14 — Módulo Proyectos en la app: listado de proyectos visibles (la RLS scopea
 * según rol). Online-first con cache; si no hay señal muestra lo cacheado + un
 * banner. Tap en un proyecto → detalle (fases + acceso al cronograma).
 */
@Component({
  selector: 'app-proyectos',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, LiveRefreshDirective, CollapsibleSelect],
  templateUrl: './proyectos.html',
  styleUrl: './proyectos.scss',
})
export class ProyectosPage {
  private proyectos = inject(ProyectosService);
  private cronograma = inject(CronogramaService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  readonly estadoLabel = PROYECTO_ESTADO_LABEL;

  lista = signal<ProyectoApp[]>([]);
  loading = signal(true);
  refrescando = signal(false);
  query = signal('');
  zonaFiltro = signal(''); // AS23 — filtro por zona
  avisosCount = signal(0); // Y15 (FASE 5)

  /** AS23 — zonas presentes entre los proyectos cargados (para el dropdown). */
  zonaOpciones = computed(() => {
    const zs = new Set<string>();
    for (const p of this.lista()) {
      const z = zonaDeProyecto(p);
      if (z) zs.add(z);
    }
    const ops = [...zs].sort().map((z) => ({ id: z, label: z }));
    return [{ id: '', label: 'Todas las zonas' }, ...ops];
  });

  // AM9 — crear proyecto: mismo gate que la web.
  puedeCrear = computed(
    () => this.ctx.esAdmin() || this.ctx.hasModulo('proyectos') || this.ctx.hasModulo('direccion'),
  );

  filtrados = computed(() => {
    const q = this.query().trim().toLowerCase();
    const zona = this.zonaFiltro();
    return this.lista().filter((p) => {
      if (zona && zonaDeProyecto(p) !== zona) return false; // AS23
      if (!q) return true;
      return (
        p.nombre.toLowerCase().includes(q) ||
        (p.codigo ?? '').toLowerCase().includes(q) ||
        (p.cliente ?? '').toLowerCase().includes(q)
      );
    });
  });

  onZona(z: string): void {
    this.zonaFiltro.set(z);
  }

  constructor() {
    void this.load();
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.lista.set(await this.proyectos.getProyectos());
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
    // Y15 — conteo de avisos de cronograma (best-effort, online).
    void this.cronograma.getAvisos().then((a) => this.avisosCount.set(a.length)).catch(() => {});
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void {
    void this.load(silent);
  }

  /** AM9 — crear un proyecto nuevo (wizard por hojas). */
  nuevo(): void {
    void this.router.navigate(['/proyectos/nuevo']);
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
