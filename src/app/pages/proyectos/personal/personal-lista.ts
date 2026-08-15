import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { UserContextService } from '../../../core/services/user-context.service';
import { PersonalObraService } from '../../../core/services/personal-obra.service';
import { Cargo, NACIONALIDADES, NACIONALIDAD_LABEL, PersonalObra } from '../../../core/models/personal-obra.model';

/** AR1 (app) — Consulta del personal de obra: conteos + buscador + filtros + rows. */
@Component({
  selector: 'app-personal-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, SyncBar, CollapsibleSelect, LiveRefreshDirective],
  templateUrl: './personal-lista.html',
  styleUrl: './personal-lista.scss',
})
export class PersonalListaPage {
  private service = inject(PersonalObraService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  readonly nacionalidades = NACIONALIDADES;
  readonly nacionalidadLabel = NACIONALIDAD_LABEL;

  loading = signal(true);
  error = signal('');
  personal = signal<PersonalObra[]>([]);
  obras = signal<{ id: string; nombre: string }[]>([]);
  cargos = signal<Cargo[]>([]);

  q = signal('');
  filObra = signal('');
  filCargo = signal('');
  filNacionalidad = signal('');
  filEstado = signal<'activo' | 'inactivo' | ''>('activo');
  mostrarFiltros = signal(false);

  obraOptions = computed(() => [{ id: '', label: 'Todas las obras' }, ...this.obras().map((o) => ({ id: o.id, label: o.nombre }))]);
  cargoOptions = computed(() => [{ id: '', label: 'Todos los cargos' }, ...this.cargos().map((c) => ({ id: c.id, label: c.nombre }))]);

  /** Oculta datos de prueba salvo al admin (QA). */
  private visibles = computed(() => this.personal().filter((p) => this.ctx.esAdmin() || !p.es_prueba));

  filtrados = computed(() => {
    const cargo = this.filCargo();
    const nac = this.filNacionalidad();
    const est = this.filEstado();
    const obra = this.filObra();
    const term = this.q().trim().toLowerCase();
    return this.visibles().filter((p) => {
      if (obra && p.proyecto_id !== obra) return false;
      if (cargo && p.cargo_id !== cargo) return false;
      if (nac && p.nacionalidad !== nac) return false;
      if (est && p.estado !== est) return false;
      if (term) {
        const hay = `${p.nombre} ${p.apellido ?? ''} ${p.documento_numero ?? ''} ${p.cargo?.nombre ?? ''} ${p.carnet_numero ?? ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  });

  /** Conteos rápidos (espejo de la web) sobre lo visible+filtrado. */
  conteos = computed(() => {
    const list = this.filtrados();
    const porCargo = new Map<string, number>();
    const porNac = new Map<string, number>();
    for (const p of list) {
      const c = p.cargo?.nombre ?? 'Sin cargo';
      porCargo.set(c, (porCargo.get(c) ?? 0) + 1);
      const n = this.nacionalidadLabel[p.nacionalidad] ?? p.nacionalidad;
      porNac.set(n, (porNac.get(n) ?? 0) + 1);
    }
    return {
      total: list.length,
      porCargo: [...porCargo.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v),
      porNacionalidad: [...porNac.entries()].map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v),
    };
  });

  puedeRegistrar = computed(
    () =>
      this.ctx.esAdmin() ||
      this.ctx.hasModulo('proyectos') ||
      this.ctx.hasModulo('rrhh') ||
      this.ctx.hasModulo('direccion') ||
      this.ctx.puedeOperarSubmodulo('proyectos.personal') ||
      this.ctx.puedeVerObra(),
  );

  constructor() {
    void this.cargar();
  }

  async cargar(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.error.set('');
    try {
      const [personal, obras, cargos] = await Promise.all([
        this.service.listar(),
        this.service.getObras().catch(() => [] as { id: string; nombre: string }[]),
        this.service.getCargos().catch(() => [] as Cargo[]),
      ]);
      this.personal.set(personal);
      this.obras.set(obras);
      this.cargos.set(cargos);
    } catch (e: unknown) {
      this.error.set(e instanceof Error ? e.message : 'No se pudo cargar el personal.');
    } finally {
      this.loading.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.cargar(silent);
  }

  toggleFiltros(): void {
    this.mostrarFiltros.update((v) => !v);
  }

  limpiarFiltros(): void {
    this.filObra.set('');
    this.filCargo.set('');
    this.filNacionalidad.set('');
    this.filEstado.set('activo');
    this.q.set('');
  }

  registrar(): void {
    void this.router.navigate(['/proyectos/personal/registrar'], {
      queryParams: this.filObra() ? { obra: this.filObra() } : {},
    });
  }

  abrir(p: PersonalObra): void {
    void this.router.navigate(['/proyectos/personal', p.id]);
  }

  back(): void {
    this.location.back();
  }
}
