import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import {
  SolicitudMovimientoService,
  SolicitudMovimiento,
  PrioridadSolicitud,
  EstadoSolicitud,
} from '../../../core/services/solicitud-movimiento.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import { VehiculoDisponible, vehiculoIdentidad } from '../../../core/models/transporte.model';
import { formatFecha } from '../../../core/util/fecha';

const PRIORIDAD_LABEL: Record<PrioridadSolicitud, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  urgente: 'Urgente',
};
const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  pendiente: 'Pendiente',
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

/**
 * AY11 — Solicitudes de movimiento. El ingeniero ve SOLO las suyas (RLS); el rol
 * referente (es_referente_movimiento) ve la bandeja completa con filtros y puede
 * PLANIFICAR (crea ruta + asigna chofer), completar o cancelar.
 */
@Component({
  selector: 'app-solicitudes-movimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, EmptyState, LiveRefreshDirective, VehiculoPicker, CollapsibleSelect],
  templateUrl: './solicitudes-movimiento.html',
  styleUrl: './solicitudes-movimiento.scss',
})
export class SolicitudesMovimientoPage {
  private solicitudes = inject(SolicitudMovimientoService);
  private conductores = inject(ConductoresService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);
  private router = inject(Router);

  fmtFecha = formatFecha;
  prioridadLabel = (p: PrioridadSolicitud) => PRIORIDAD_LABEL[p] ?? p;
  estadoLabel = (e: EstadoSolicitud) => ESTADO_LABEL[e] ?? e;

  loading = signal(true);
  refrescando = signal(false);
  esReferente = signal(false);
  lista = signal<SolicitudMovimiento[]>([]);

  // Filtros (solo referente).
  filtroEstado = signal<EstadoSolicitud | ''>('');
  filtroPrioridad = signal<PrioridadSolicitud | ''>('');

  // Hoja de planificación.
  planificando = signal<SolicitudMovimiento | null>(null);
  planVehiculoId = signal('');
  planVehiculoLabel = signal('');
  planConductorId = signal('');
  planFecha = signal('');
  conductorOpts = signal<SelectOption[]>([]);
  guardandoPlan = signal(false);

  readonly estados: EstadoSolicitud[] = ['pendiente', 'planificada', 'en_curso', 'completada', 'cancelada'];
  readonly prioridades: PrioridadSolicitud[] = ['baja', 'media', 'alta', 'urgente'];

  puedePlanificar = computed(() => !!this.planVehiculoId() && !this.guardandoPlan());

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.esReferente.set(await this.solicitudes.esReferente().catch(() => false));
    if (this.esReferente()) {
      void this.conductores
        .getConductores()
        .then((cs) => this.conductorOpts.set(cs.map((c) => ({ id: c.id, label: c.nombre }))))
        .catch(() => {});
    }
    await this.load();
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    try {
      this.lista.set(
        await this.solicitudes.listar({
          estado: this.filtroEstado() || null,
          prioridad: this.filtroPrioridad() || null,
        }),
      );
    } catch {
      this.toast.error('No pudimos cargar las solicitudes.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  refrescar(silent = false): void {
    void this.load(silent);
  }

  aplicarFiltroEstado(e: EstadoSolicitud | ''): void {
    this.filtroEstado.set(e);
    void this.load(true);
  }
  aplicarFiltroPrioridad(p: PrioridadSolicitud | ''): void {
    this.filtroPrioridad.set(p);
    void this.load(true);
  }

  crear(): void {
    void this.router.navigate(['/transporte/crear-solicitud-movimiento']);
  }

  // ── Semáforo de urgencia por fecha de requerimiento (AY11.f) ────────────────
  urgencia(s: SolicitudMovimiento): 'vencida' | 'urgente' | 'proxima' | 'normal' | 'na' {
    if (s.estado === 'completada' || s.estado === 'cancelada') return 'na';
    const d = s.dias_para_requerimiento;
    if (d == null) return 'na';
    if (d < 0) return 'vencida';
    if (d <= 2) return 'urgente';
    if (d <= 5) return 'proxima';
    return 'normal';
  }
  urgenciaTexto(s: SolicitudMovimiento): string {
    const d = s.dias_para_requerimiento;
    if (d == null) return '';
    if (d < 0) return `Vencida hace ${Math.abs(d)} día${Math.abs(d) === 1 ? '' : 's'}`;
    if (d === 0) return 'Para hoy';
    if (d === 1) return 'Para mañana';
    return `En ${d} días`;
  }

  // ── Planificación (referente) ───────────────────────────────────────────────
  abrirPlanificar(s: SolicitudMovimiento): void {
    this.planificando.set(s);
    this.planVehiculoId.set('');
    this.planVehiculoLabel.set('');
    this.planConductorId.set('');
    this.planFecha.set(s.fecha_requerimiento ?? '');
  }
  cerrarPlanificar(): void {
    this.planificando.set(null);
  }
  onVehiculo(v: VehiculoDisponible): void {
    this.planVehiculoId.set(v.vehiculo_id);
    this.planVehiculoLabel.set(vehiculoIdentidad(v));
  }

  async confirmarPlanificar(): Promise<void> {
    const s = this.planificando();
    if (!s || !this.puedePlanificar()) return;
    this.guardandoPlan.set(true);
    try {
      await this.solicitudes.planificar(
        s.id,
        this.planVehiculoId(),
        this.planConductorId() || null,
        this.planFecha() || null,
        null,
      );
      this.toast.success('Ruta creada y solicitud planificada.');
      this.cerrarPlanificar();
      await this.load(true);
    } catch {
      this.toast.error('No pudimos planificar la solicitud. Revisa la conexión.');
    } finally {
      this.guardandoPlan.set(false);
    }
  }

  async completar(s: SolicitudMovimiento): Promise<void> {
    try {
      await this.solicitudes.completar(s.id);
      this.toast.success('Solicitud marcada como completada.');
      await this.load(true);
    } catch {
      this.toast.error('No pudimos completar la solicitud.');
    }
  }

  async cancelar(s: SolicitudMovimiento): Promise<void> {
    try {
      await this.solicitudes.cancelar(s.id, 'Cancelada desde la app');
      this.toast.success('Solicitud cancelada.');
      await this.load(true);
    } catch {
      this.toast.error('No pudimos cancelar la solicitud.');
    }
  }

  back(): void {
    this.navGuard.back('/transporte');
  }
}
