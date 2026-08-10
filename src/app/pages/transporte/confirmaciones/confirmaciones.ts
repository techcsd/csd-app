import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ConducesService,
  ConfirmacionHistorialRow,
  ConfirmacionDetalle,
} from '../../../core/services/conduces.service';
import { formatFecha, formatFechaHumana } from '../../../core/util/fecha';

type EstadoFiltro = 'todas' | 'completa' | 'incompleta';

/**
 * AK1 — Historial de confirmaciones de entrega. Listado filtrable (fecha/obra/
 * estado); cada fila abre el detalle completo (items, quién entregó/confirmó,
 * cuándo, fotos de evidencia, firmas). La visibilidad la resuelve el server por
 * matriz de roles (admin/globales todo; responsables sus obras; chofer lo suyo).
 */
@Component({
  selector: 'app-confirmaciones',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, OptionButton, CollapsibleSelect],
  templateUrl: './confirmaciones.html',
  styleUrl: './confirmaciones.scss',
})
export class ConfirmacionesPage {
  private conduces = inject(ConducesService);
  private navGuard = inject(NavGuardService);
  private toast = inject(ToastService);

  readonly fmtFecha = formatFecha;
  readonly fmtFechaHora = formatFechaHumana;

  loading = signal(true);
  filas = signal<ConfirmacionHistorialRow[]>([]);

  // Filtros
  estado = signal<EstadoFiltro>('todas');
  obraId = signal('');
  desde = signal('');
  hasta = signal('');
  obras = signal<SelectOption[]>([]);
  obraOptions = computed<SelectOption[]>(() => [
    { id: '', label: 'Todas las obras' },
    ...this.obras(),
  ]);

  // Detalle expandible por fila.
  expandidaId = signal('');
  detalle = signal<ConfirmacionDetalle | null>(null);
  detalleLoading = signal(false);

  constructor() {
    void this.cargarObras();
    void this.load();
  }

  private async cargarObras(): Promise<void> {
    try {
      const ps = await this.conduces.getProyectos();
      this.obras.set(ps.map((p) => ({ id: p.id, label: p.nombre })));
    } catch {
      /* best-effort */
    }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const e = this.estado();
    try {
      this.filas.set(
        await this.conduces.confirmacionesHistorial({
          desde: this.desde() || null,
          hasta: this.hasta() || null,
          proyectoId: this.obraId() || null,
          estado: e === 'todas' ? null : e,
        }),
      );
    } catch {
      this.toast.error('No pudimos cargar el historial de confirmaciones.');
    } finally {
      this.loading.set(false);
    }
  }

  setEstado(e: EstadoFiltro): void {
    this.estado.set(e);
    void this.load();
  }
  onObra(id: string): void {
    this.obraId.set(id);
    void this.load();
  }

  estadoLabel(estado: string): string {
    return estado === 'entregado_incompleto' ? 'Incompleta' : estado === 'entregado' ? 'Completa' : estado;
  }

  async toggleDetalle(row: ConfirmacionHistorialRow): Promise<void> {
    if (this.expandidaId() === row.id) {
      this.expandidaId.set('');
      this.detalle.set(null);
      return;
    }
    this.expandidaId.set(row.id);
    this.detalle.set(null);
    this.detalleLoading.set(true);
    try {
      this.detalle.set(await this.conduces.confirmacionDetalle(row.id));
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No pudimos abrir el detalle.');
      this.expandidaId.set('');
    } finally {
      this.detalleLoading.set(false);
    }
  }

  back(): void {
    this.navGuard.back('/transporte/conduces-hub');
  }
}
