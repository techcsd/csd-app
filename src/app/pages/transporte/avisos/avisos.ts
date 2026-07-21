import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { VehiculosService, FlotaAviso } from '../../../core/services/vehiculos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { formatFechaMedia } from '../../../core/util/fecha';

const TIPO_LABEL: Record<string, string> = {
  seguro: 'Seguro por vencer',
  matricula: 'Matrícula por vencer',
  pre_cita: 'Pre-cita de mantenimiento',
  mantenimiento: 'Mantenimiento',
  hallazgos: 'Hallazgos de checklist',
  reporte_semanal: 'Reporte semanal pendiente',
  bloqueo: 'Vehículo bloqueado',
};

// S33 — icono por tipo (escaneable de un vistazo).
const TIPO_ICON: Record<string, string> = {
  seguro: '🛡️',
  matricula: '📄',
  pre_cita: '🔧',
  mantenimiento: '🔧',
  hallazgos: '⚠️',
  reporte_semanal: '📋',
  bloqueo: '⛔',
};

type Filtro = 'todos' | 'criticos' | 'mios';

/** Avisos de flota (R6/R9): pre-cita, vencimientos, hallazgos + reactivar. */
@Component({
  selector: 'app-avisos-flota',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, Skeleton],
  templateUrl: './avisos.html',
  styleUrl: './avisos.scss',
})
export class AvisosFlotaPage {
  private vehiculos = inject(VehiculosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private location = inject(Location);
  private router = inject(Router);
  private ctx = inject(UserContextService);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  avisos = signal<FlotaAviso[]>([]);
  busyId = signal<string | null>(null);
  filtro = signal<Filtro>('todos');

  /** S33 — un aviso "crítico" (bloqueo, mantenimiento vencido o severidad alta). */
  esCritico(a: FlotaAviso): boolean {
    const sev = (a.severidad ?? '').toLowerCase();
    return this.esBloqueo(a) || sev === 'alta' || sev === 'critica' || a.tipo === 'bloqueo' || a.tipo === 'mantenimiento';
  }
  private rank(a: FlotaAviso): number {
    return this.esCritico(a) ? 0 : 1; // críticos arriba
  }

  criticosCount = computed(() => this.avisos().filter((a) => this.esCritico(a)).length);
  miosCount = computed(() => {
    const uid = this.ctx.profile()?.id;
    return uid ? this.avisos().filter((a) => a.conductor_id === uid).length : 0;
  });

  /** S33 — filtrados (Todos/Críticos/Míos) y ordenados con los críticos primero. */
  avisosFiltrados = computed<FlotaAviso[]>(() => {
    const uid = this.ctx.profile()?.id;
    const f = this.filtro();
    const list = this.avisos().filter((a) => {
      if (f === 'criticos') return this.esCritico(a);
      if (f === 'mios') return !!uid && a.conductor_id === uid;
      return true;
    });
    return [...list].sort((a, b) => this.rank(a) - this.rank(b) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  });

  constructor() {
    void this.load();
  }

  setFiltro(f: Filtro): void {
    this.filtro.set(f);
  }
  tipoIcon(t: string): string {
    return TIPO_ICON[t] ?? '🔔';
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.avisos.set(await this.vehiculos.getAvisosFlota());
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(t: string): string {
    return TIPO_LABEL[t] ?? t;
  }

  esBloqueo(a: FlotaAviso): boolean {
    return a.vehiculo?.estado === 'no_disponible';
  }

  /** Q2 — navegar al ÍTEM del aviso (no solo la acción inline). */
  puedeVer(a: FlotaAviso): boolean {
    return a.tipo === 'reporte_semanal' || !!a.vehiculo_id;
  }
  irAlItem(a: FlotaAviso): void {
    if (a.tipo === 'reporte_semanal') {
      // El destino resalta el vehículo señalado con ?item= (patrón Q2).
      void this.router.navigate(['/transporte/reporte-semanal'], {
        queryParams: a.vehiculo_id ? { item: a.vehiculo_id } : {},
      });
      return;
    }
    if (a.vehiculo_id) {
      void this.router.navigate(['/transporte/vehiculo', a.vehiculo_id]);
    }
  }

  async accion(a: FlotaAviso): Promise<void> {
    if (this.busyId()) return;
    if (!this.network.online()) {
      this.toast.error('Necesitas conexión para esto.');
      return;
    }
    this.busyId.set(a.id);
    try {
      if (this.esBloqueo(a) && a.vehiculo_id) {
        await this.vehiculos.reactivarVehiculo(a.vehiculo_id, null);
        this.toast.success('Vehículo reactivado.');
      } else {
        await this.vehiculos.atenderAviso(a.id, null);
        this.toast.success('Aviso marcado como atendido.');
      }
      this.avisos.update((list) => list.filter((x) => x.id !== a.id));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo completar la acción.');
    } finally {
      this.busyId.set(null);
    }
  }

  back(): void {
    this.location.back();
  }
}
