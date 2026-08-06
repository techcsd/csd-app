import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Counter } from '../../../shared/ui/counter/counter';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ObraService } from '../../../core/services/obra.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { PlanDelDia } from '../../../core/models/obra.model';

const ESTADO_TAREA: Record<string, { label: string; tint: string }> = {
  pendiente: { label: 'Pendiente', tint: '#ca8a04' },
  en_progreso: { label: 'En progreso', tint: '#2563eb' },
  completada: { label: 'Completada', tint: '#16a34a' },
  cancelada: { label: 'Cancelada', tint: '#6b7280' },
};

/** AG16 FASE 1 — Plan del día de una obra: charla de seguridad + tareas del día. */
@Component({
  selector: 'app-obra-plan-dia',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, Counter],
  templateUrl: './plan-dia.html',
  styleUrl: './plan-dia.scss',
})
export class PlanDiaPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private obra = inject(ObraService);
  private ctx = inject(UserContextService);
  protected network = inject(NetworkService);
  private toast = inject(ToastService);

  proyectoId = '';
  readonly hoy = new Date().toISOString().slice(0, 10);
  loading = signal(true);
  plan = signal<PlanDelDia>({ charla: null, tareas: [] });

  puedeOperar = computed(() => this.ctx.puedeOperarSubmodulo('obra.plan_dia'));

  // Asignar tarea (FASE 1)
  asignando = signal(false);
  tTitulo = signal('');
  tBrigada = signal('');
  tCapatazBusqueda = signal('');
  tCapatazRes = signal<{ id: string; nombre: string }[]>([]);
  tCapataz = signal<{ id: string; nombre: string } | null>(null);
  guardandoTarea = signal(false);

  // Parte de mano de obra (FASE 4 — horas-hombre)
  moAbierto = signal(false);
  moTrabajadores = signal(0);
  moHoras = signal(8);
  moActividad = signal('');
  guardandoMo = signal(false);

  constructor() {
    this.proyectoId = this.route.snapshot.paramMap.get('proyectoId') ?? '';
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.loading.set(true);
    try {
      this.plan.set(await this.obra.planDelDia(this.proyectoId, this.hoy));
    } finally {
      this.loading.set(false);
    }
  }

  estadoMeta(e: string): { label: string; tint: string } {
    return ESTADO_TAREA[e] ?? { label: e, tint: '#6b7280' };
  }

  registrarCharla(): void {
    void this.router.navigate(['/obra/charla', this.proyectoId]);
  }

  // ── Asignar tarea ──────────────────────────────────────────────────────────
  async buscarCapataz(): Promise<void> {
    const term = this.tCapatazBusqueda().trim();
    if (term.length < 2) {
      this.tCapatazRes.set([]);
      return;
    }
    this.tCapatazRes.set(await this.obra.buscarUsuarios(term));
  }
  pickCapataz(u: { id: string; nombre: string }): void {
    this.tCapataz.set(u);
    this.tCapatazRes.set([]);
    this.tCapatazBusqueda.set('');
  }
  cancelarAsignar(): void {
    this.asignando.set(false);
    this.tTitulo.set('');
    this.tBrigada.set('');
    this.tCapataz.set(null);
    this.tCapatazBusqueda.set('');
    this.tCapatazRes.set([]);
  }

  async guardarTarea(): Promise<void> {
    if (this.guardandoTarea() || !this.tTitulo().trim()) return;
    this.guardandoTarea.set(true);
    try {
      await this.obra.asignarTarea({
        proyectoId: this.proyectoId,
        titulo: this.tTitulo().trim(),
        descripcion: null,
        asignadoA: this.tCapataz()?.id ?? null,
        brigada: this.tBrigada().trim() || null,
        prioridad: 'media',
        fechaLimite: this.hoy,
      });
      this.toast.success('Tarea asignada.');
      this.cancelarAsignar();
      await this.cargar();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo asignar la tarea.');
    } finally {
      this.guardandoTarea.set(false);
    }
  }

  // ── Parte de mano de obra ──────────────────────────────────────────────────
  async guardarManoObra(): Promise<void> {
    if (this.guardandoMo() || this.moTrabajadores() <= 0) return;
    this.guardandoMo.set(true);
    try {
      await this.obra.enqueueManoObra({
        proyectoId: this.proyectoId,
        fecha: this.hoy,
        actividad: this.moActividad().trim() || 'General',
        cantidadTrabajadores: this.moTrabajadores(),
        horas: this.moHoras(),
        notas: null,
      });
      this.toast.success(this.network.online() ? 'Parte de mano de obra registrado.' : 'Guardado. Se enviará cuando tengas señal.');
      this.moAbierto.set(false);
      this.moTrabajadores.set(0);
      this.moHoras.set(8);
      this.moActividad.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar.');
    } finally {
      this.guardandoMo.set(false);
    }
  }

  back(): void {
    void this.router.navigate(['/obra']);
  }
}
