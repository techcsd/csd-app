import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { EmptyState } from '../../../shared/ui/empty-state/empty-state';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
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
  imports: [FormsModule, DecimalPipe, Skeleton, EmptyState, OptionButton, CollapsibleSelect, LiveRefreshDirective],
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
  refrescando = signal(false);
  filas = signal<ConfirmacionHistorialRow[]>([]);

  // AL8 — alcance: "Mías" (lo que YO confirmé) por defecto, o "Todas" (matriz/admin).
  modo = signal<'mias' | 'todas'>('mias');

  // Filtros
  estado = signal<EstadoFiltro>('todas');
  obraId = signal('');
  desde = signal('');
  hasta = signal('');
  obras = signal<SelectOption[]>([]);
  // AQ12 — Bodega Central (y demás almacenes centrales) también son destino de
  // confirmaciones: se listan junto a las obras. Guardamos sus ids para el filtro
  // client-side de "Mías" (donde el destino es un almacén, no una obra).
  centrales = signal<SelectOption[]>([]);
  private centralIds = computed(() => new Set(this.centrales().map((c) => c.id)));
  obraOptions = computed<SelectOption[]>(() => [
    { id: '', label: 'Todas las obras' },
    ...this.centrales(),
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
    // AQ12 — almacenes centrales (Bodega Central) como destino de confirmaciones.
    try {
      const cs = await this.conduces.almacenesDestino();
      this.centrales.set(
        cs.filter((c) => c.es_central).map((c) => ({ id: c.id, label: `🏢 ${c.nombre}` })),
      );
    } catch {
      /* best-effort */
    }
  }

  async load(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    this.refrescando.set(true);
    const e = this.estado();
    try {
      if (this.modo() === 'mias') {
        // AL8 — mis confirmaciones (mis_confirmaciones no filtra por estado/obra en
        // server → se filtra en cliente para conservar los mismos controles).
        let rows = await this.conduces.misConfirmaciones({
          desde: this.desde() || null,
          hasta: this.hasta() || null,
        });
        if (this.obraId()) {
          const oid = this.obraId();
          // AQ12 — si el filtro es un almacén central, el destino no es una obra
          // (proyecto_id null); las obras se filtran por su id como siempre.
          rows = this.centralIds().has(oid)
            ? rows.filter((r) => !r.proyecto_id)
            : rows.filter((r) => r.proyecto_id === oid);
        }
        if (e === 'completa') rows = rows.filter((r) => r.estado !== 'entregado_incompleto');
        else if (e === 'incompleta') rows = rows.filter((r) => r.estado === 'entregado_incompleto');
        this.filas.set(rows);
      } else {
        this.filas.set(
          await this.conduces.confirmacionesHistorial({
            desde: this.desde() || null,
            hasta: this.hasta() || null,
            proyectoId: this.obraId() || null,
            estado: e === 'todas' ? null : e,
          }),
        );
      }
    } catch {
      this.toast.error('No pudimos cargar el historial de confirmaciones.');
    } finally {
      this.loading.set(false);
      this.refrescando.set(false);
    }
  }

  /** AM2 — refresco homologado (botón + pull-to-refresh + foreground). */
  refrescar(silent = false): void { void this.load(silent); }

  setModo(m: 'mias' | 'todas'): void {
    if (this.modo() === m) return;
    this.modo.set(m);
    this.expandidaId.set('');
    void this.load();
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
