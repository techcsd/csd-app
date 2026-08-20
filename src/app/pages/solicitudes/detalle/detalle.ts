import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { RequisicionDetalle } from '../../../core/models/inventario.model';
import { Bodega } from '../../../core/models/inventario.model';
import { formatFechaMedia } from '../../../core/util/fecha';

/** AS7/AS6 — Detalle completo de una requisición (destino del deep-link de la push):
 *  artículos, notas, estado, obra, solicitante, y links a conduce/compra. Read-only. */
@Component({
  selector: 'app-requisicion-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton, CollapsibleSelect],
  templateUrl: './detalle.html',
  styleUrl: './detalle.scss',
})
export class RequisicionDetallePage {
  private service = inject(SolicitudesService);
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  fmtFecha = formatFechaMedia;

  loading = signal(true);
  req = signal<RequisicionDetalle | null>(null);
  error = signal(false);

  // AS7 — gestión (aprobar/rechazar) solo para admin/módulo inventario.
  modo = signal<'none' | 'aprobar' | 'rechazar'>('none');
  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  responsable = signal('');
  observaciones = signal('');
  rechazoNota = signal('');
  procesando = signal(false);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  puedeGestionar = computed(() => this.ctx.esAdmin() || this.ctx.hasModulo('inventario'));
  esPendiente = computed(() => this.req()?.estado === 'pendiente');
  get online(): boolean {
    return this.net.online();
  }

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.loading.set(true);
    try {
      const r = await this.service.detalle(id);
      if (!r) this.error.set(true);
      else this.req.set(r);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
    // Almacenes para el despacho (solo si puede gestionar).
    if (this.puedeGestionar()) {
      this.inventario.getBodegas().then((b) => this.bodegas.set(b)).catch(() => {});
    }
  }

  private hoy(): string {
    return new Date().toISOString().slice(0, 10);
  }

  abrirAprobar(): void {
    this.modo.set('aprobar');
  }
  abrirRechazar(): void {
    this.modo.set('rechazar');
  }
  cancelarAccion(): void {
    this.modo.set('none');
  }

  async confirmarAprobar(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén de despacho.');
      return;
    }
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para aprobar.');
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.aprobarRequisicion({
        id: r.id,
        bodegaId: this.bodegaId(),
        fecha: this.hoy(),
        responsable: this.responsable().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: r.items.map((i) => ({
          articulo_id: i.articulo_id,
          descripcion: i.descripcion,
          cantidad: i.cantidad,
          unidad: i.unidad,
          talla: i.talla,
        })),
      });
      this.toast.success('Requisición aprobada. Se despachó lo disponible; el faltante generó una compra.');
      this.modo.set('none');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo aprobar.');
    } finally {
      this.procesando.set(false);
    }
  }

  async confirmarRechazar(): Promise<void> {
    const r = this.req();
    if (!r || this.procesando()) return;
    if (!this.net.online()) {
      this.toast.error('Necesitas conexión para rechazar.');
      return;
    }
    this.procesando.set(true);
    try {
      await this.service.rechazarRequisicion(r.id, this.rechazoNota().trim() || null);
      this.toast.success('Requisición rechazada.');
      this.modo.set('none');
      await this.load();
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo rechazar.');
    } finally {
      this.procesando.set(false);
    }
  }

  estadoLabel(e: string): string {
    switch (e) {
      case 'pendiente': return 'Pendiente';
      case 'aprobada': return 'Aprobada';
      case 'entregada': return 'Entregada';
      case 'cerrada': return 'Cerrada';
      case 'rechazada': return 'Rechazada';
      default: return e;
    }
  }

  back(): void {
    this.location.back();
  }
}
