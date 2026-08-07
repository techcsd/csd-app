import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { RrhhService, Empleado } from '../../../core/services/rrhh.service';

/** AH16 — listado de empleados (consulta) para el jefe de RRHH. */
@Component({
  selector: 'app-rrhh-empleados',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, SyncBar],
  templateUrl: './rrhh-empleados.html',
  styleUrl: './rrhh-empleados.scss',
})
export class RrhhEmpleadosPage {
  private rrhh = inject(RrhhService);
  private router = inject(Router);
  private location = inject(Location);

  loading = signal(true);
  empleados = signal<Empleado[]>([]);
  q = signal('');

  lista = computed(() => {
    const term = this.q().trim().toLowerCase();
    const all = this.empleados();
    if (!term) return all;
    return all.filter((e) =>
      [e.nombre, e.apellido, e.cargo, e.departamento, e.cedula].some((v) => (v ?? '').toLowerCase().includes(term)),
    );
  });

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.empleados.set(await this.rrhh.empleados());
    } finally {
      this.loading.set(false);
    }
  }

  nombreCompleto(e: Empleado): string {
    return [e.nombre, e.apellido].filter(Boolean).join(' ') || 'Empleado';
  }

  abrir(e: Empleado): void {
    void this.router.navigate(['/rrhh/empleado', e.id]);
  }

  back(): void {
    this.location.back();
  }
}
