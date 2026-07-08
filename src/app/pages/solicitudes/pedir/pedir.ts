import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { SolicitudesService } from '../../../core/services/solicitudes.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Proyecto } from '../../../core/models/bitacora.model';
import { ArticuloCat, MovItem, Urgencia } from '../../../core/models/inventario.model';

/** Request materials from the field: cart + urgency → SGC Solicitudes. */
@Component({
  selector: 'app-pedir',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BigConfirm, ArticuloPicker],
  templateUrl: './pedir.html',
  styleUrl: './pedir.scss',
})
export class PedirPage {
  private solicitudes = inject(SolicitudesService);
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private ctx = inject(UserContextService);

  proyectos = signal<Proyecto[]>([]);
  proyectoId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  cart = signal<MovItem[]>([]);
  urgencia = signal<Urgencia>('normal');
  submitting = signal(false);
  done = signal(false);

  cartIds = computed(() => this.cart().map((c) => c.articulo_id));

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [p, a] = await Promise.all([
      this.solicitudes.getProyectos(),
      this.inventario.getArticulos(),
    ]);
    this.proyectos.set(p);
    this.articulos.set(a);
    const obra = this.ctx.obraActiva();
    if (obra) this.proyectoId.set(obra.id);
    else if (p.length === 1) this.proyectoId.set(p[0].id);
  }

  add(a: ArticuloCat): void {
    this.cart.update((c) => [...c, { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, cantidad: 1 }]);
  }
  setCantidad(i: number, v: number): void {
    this.cart.update((c) => c.map((x, idx) => (idx === i ? { ...x, cantidad: Math.max(0, v || 0) } : x)));
  }
  remove(i: number): void {
    this.cart.update((c) => c.filter((_, idx) => idx !== i));
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.proyectoId()) {
      this.toast.error('Elige la obra.');
      return;
    }
    const items = this.cart().filter((c) => c.cantidad > 0);
    if (!items.length) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.solicitudes.enqueueSolicitud({
        proyectoId: this.proyectoId(),
        urgencia: this.urgencia(),
        notas: null,
        items: items.map((c) => ({
          articulo_id: c.articulo_id,
          descripcion: c.nombre,
          cantidad: c.cantidad,
          unidad: c.unidad,
        })),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo enviar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/solicitudes'], { replaceUrl: true });
  }
}
