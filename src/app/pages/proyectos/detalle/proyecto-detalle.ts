import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { ProyectosService } from '../../../core/services/proyectos.service';
import { NetworkService } from '../../../core/services/network.service';
import { UserContextService } from '../../../core/services/user-context.service';
import {
  ProyectoApp,
  FaseProyecto,
  ResponsableProyecto,
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
  imports: [Skeleton, EmptyState, DecimalPipe],
  templateUrl: './proyecto-detalle.html',
  styleUrl: './proyecto-detalle.scss',
})
export class ProyectoDetallePage {
  private proyectos = inject(ProyectosService);
  private network = inject(NetworkService);
  private ctx = inject(UserContextService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);

  readonly estadoLabel = PROYECTO_ESTADO_LABEL;
  readonly faseEstadoLabel = FASE_ESTADO_LABEL;

  private id = this.route.snapshot.paramMap.get('id') ?? '';
  proyecto = signal<ProyectoApp | null>(null);
  responsables = signal<ResponsableProyecto[]>([]);
  loading = signal(true);

  // AM9 — mismo gate que la web (set_proyecto_ubicacion / edición de proyecto).
  puedeEditar = computed(
    () => this.ctx.esAdmin() || this.ctx.hasModulo('proyectos') || this.ctx.hasModulo('direccion'),
  );

  // AY4 — costos/finanzas del proyecto (p. ej. Presupuesto) SOLO a nivel operar
  // (admin/gerencia/proyectos). El rol Ingenieros entra con `proyectos.obras=ver`:
  // ve la ficha de su obra PERO no los costos. Espejo del submoduloOperarGuard web.
  puedeVerCostos = computed(
    () => this.ctx.esAdmin() || this.ctx.puedeOperarSubmodulo('proyectos.obras'),
  );

  // AM7 — link a Google Maps si hay coordenadas estructuradas.
  mapsUrl = computed(() => {
    const p = this.proyecto();
    if (p?.latitud == null || p?.longitud == null) return null;
    return `https://www.google.com/maps/search/?api=1&query=${p.latitud},${p.longitud}`;
  });

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
    // AM9 — equipo/responsables (best-effort, online).
    void this.proyectos.responsablesDeProyecto(this.id).then((r) => this.responsables.set(r)).catch(() => {});
  }

  editar(): void {
    void this.router.navigate(['/proyectos', this.id, 'editar']);
  }

  trackResp = (_: number, r: ResponsableProyecto) => r.id;

  get online(): boolean {
    return this.network.online();
  }

  fmt(iso: string | null): string {
    return iso ? formatFecha(iso) : '—';
  }

  cronograma(): void {
    void this.router.navigate(['/proyectos', this.id, 'cronograma']);
  }

  // AS24 — accesos directos a los sub-módulos de esta obra (antes solo se llegaba
  // por los tiles del home). El destino preselecciona esta obra por ?obra=.
  comprasYGastos(): void {
    void this.router.navigate(['/compras-proyecto'], { queryParams: { obra: this.id } });
  }
  personal(): void {
    void this.router.navigate(['/proyectos/personal'], { queryParams: { obra: this.id } });
  }

  /** AS24 — accesos a Personal según el gate del tile del home. */
  puedeVerPersonal = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('rrhh') ||
      this.ctx.hasModulo('direccion') ||
      this.ctx.puedeVerSubmodulo('proyectos.personal') ||
      this.ctx.puedeVerObra(),
  );

  trackFase = (_: number, f: FaseProyecto) => f.id;

  back(): void {
    this.location.back();
  }
}
