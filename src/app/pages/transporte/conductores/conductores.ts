import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConductoresService } from '../../../core/services/conductores.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Conductor, estadoLicencia, LicenciaEstado } from '../../../core/models/conductor.model';

const LIC_LABEL: Record<LicenciaEstado, string> = {
  vigente: 'Licencia vigente',
  por_vencer: 'Licencia por vencer',
  vencida: 'Licencia vencida',
  desconocido: 'Sin licencia',
};

/** Browse all drivers → tap one to open its profile (R5). */
@Component({
  selector: 'app-conductores-lista',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EmptyState, Skeleton],
  templateUrl: './conductores.html',
  styleUrl: './conductores.scss',
})
export class ConductoresListaPage {
  private conductores = inject(ConductoresService);
  private ctx = inject(UserContextService);
  private router = inject(Router);
  private location = inject(Location);

  esAdmin = () => this.ctx.hasModulo('admin');

  loading = signal(true);
  private todos = signal<Conductor[]>([]);
  query = signal('');

  lista = computed(() => {
    const q = this.query().toLowerCase().trim();
    const base = this.todos();
    if (!q) return base;
    return base.filter(
      (c) => c.nombre.toLowerCase().includes(q) || (c.cedula ?? '').toLowerCase().includes(q),
    );
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.todos.set(await this.conductores.getConductores());
    } finally {
      this.loading.set(false);
    }
  }

  licEstado(c: Conductor): LicenciaEstado {
    return estadoLicencia(c.licencia_vencimiento);
  }
  licLabel(c: Conductor): string {
    return LIC_LABEL[this.licEstado(c)];
  }

  ver(c: Conductor): void {
    void this.router.navigate(['/transporte/conductor', c.id]);
  }

  nuevo(): void {
    void this.router.navigate(['/transporte/conductores/nuevo']);
  }

  back(): void {
    this.location.back();
  }
}
