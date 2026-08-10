import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { CronogramaTarea } from '../../../core/models/obra.model';

/** AG16 FASE 4 — Avance real vs plan + reporte de % por tarea del cronograma. */
@Component({
  selector: 'app-obra-avance',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState],
  templateUrl: './avance.html',
  styleUrl: './avance.scss',
})
export class AvancePage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);

  proyectoId = '';
  loading = signal(true);
  resumen = signal<{ plan: number; real: number } | null>(null);
  tareas = signal<CronogramaTarea[]>([]);
  edit = signal<Record<string, number>>({});
  guardando = signal<string | null>(null);

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      const [res, tareas] = await Promise.all([
        this.obra.avanceObra(this.proyectoId),
        this.obra.cronogramaTareas(this.proyectoId),
      ]);
      this.resumen.set(res);
      this.tareas.set(tareas);
      const e: Record<string, number> = {};
      for (const t of tareas) e[t.id] = Number(t.avance_pct) || 0;
      this.edit.set(e);
    } finally {
      this.loading.set(false);
    }
  }

  set(id: string, v: number): void {
    this.edit.update((e) => ({ ...e, [id]: Math.max(0, Math.min(100, v || 0)) }));
  }

  async reportar(id: string): Promise<void> {
    if (this.guardando()) return;
    this.guardando.set(id);
    try {
      await this.obra.enqueueAvanceTarea(id, this.edit()[id] ?? 0);
      // Optimista: refleja el nuevo % en la lista.
      this.tareas.update((list) => list.map((t) => (t.id === id ? { ...t, avance_pct: this.edit()[id] } : t)));
      this.toast.success(this.network.online() ? 'Avance reportado.' : 'Guardado. Se enviará cuando tengas señal.');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo reportar el avance.');
    } finally {
      this.guardando.set(null);
    }
  }

  back(): void {
    this.navGuard.back('/obra');
  }
}
