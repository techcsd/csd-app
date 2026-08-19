import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import {
  SolicitudMovimientoService,
  SolicitudMovimiento,
  PrioridadSolicitud,
  EstadoSolicitud,
} from '../../../core/services/solicitud-movimiento.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
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
  imports: [FormsModule, Skeleton, EmptyState, LiveRefreshDirective],
  templateUrl: './solicitudes-movimiento.html',
  styleUrl: './solicitudes-movimiento.scss',
})
export class SolicitudesMovimientoPage {
  private solicitudes = inject(SolicitudMovimientoService);
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

  planificandoId = signal('');

  readonly estados: EstadoSolicitud[] = ['pendiente', 'planificada', 'en_curso', 'completada', 'cancelada'];
  readonly prioridades: PrioridadSolicitud[] = ['baja', 'media', 'alta', 'urgente'];

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.esReferente.set(await this.solicitudes.esReferente().catch(() => false));
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

  // ── Planificación (referente) → wizard de crear-ruta PRE-LLENADO ─────────────
  /**
   * AY11 — planificar = crear la ruta en el wizard normal de crear-ruta, PRE-LLENADO
   * desde la solicitud (origen/destino según la obra y la dirección). Al guardar la
   * ruta, se vincula a la solicitud (queda 'planificada'). No le damos Flota al
   * ingeniero: es el referente quien planifica desde su bandeja.
   */
  async planificar(s: SolicitudMovimiento): Promise<void> {
    if (this.planificandoId()) return;
    this.planificandoId.set(s.id);
    try {
      const d = await this.solicitudes.detalle(s.id);
      const qp: Record<string, string> = { solicitud: s.id };
      // La obra ancla + el otro extremo, para pre-llenar origen/destino en crear-ruta.
      if (d?.destino_proyecto_id) qp['destinoLugarId'] = d.destino_proyecto_id;
      if (d?.origen_proyecto_id) qp['origenLugarId'] = d.origen_proyecto_id;
      if (d?.origen_texto) qp['origenTexto'] = d.origen_texto;
      if (d?.destino_texto) qp['destinoTexto'] = d.destino_texto;
      if (d?.fecha_requerimiento) qp['fecha'] = d.fecha_requerimiento;
      if (d?.notas) qp['notas'] = d.notas;
      await this.router.navigate(['/transporte/rutas/crear'], { queryParams: qp });
    } catch {
      this.toast.error('No pudimos abrir el planificador. Revisa la conexión.');
    } finally {
      this.planificandoId.set('');
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
