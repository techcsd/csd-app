import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ArticuloCat, Bodega, MovItem } from '../../../core/models/inventario.model';

/** Register a material consumption (salida) from a bodega. Offline-first. */
@Component({
  selector: 'app-salida',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BigConfirm, ArticuloPicker, SelectList],
  templateUrl: './salida.html',
  styleUrl: './salida.scss',
})
export class SalidaPage {
  private inventario = inject(InventarioService);
  private camera = inject(CameraService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  cart = signal<MovItem[]>([]);
  foto = signal<CapturedPhoto | null>(null);
  capturing = signal(false);
  submitting = signal(false);
  done = signal(false);

  cartIds = computed(() => this.cart().map((c) => c.articulo_id));
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [b, a] = await Promise.all([
      this.inventario.getBodegas(),
      this.inventario.getArticulos(),
    ]);
    this.bodegas.set(b);
    this.articulos.set(a);
    if (b.length === 1) this.bodegaId.set(b[0].id);
  }

  add(a: ArticuloCat): void {
    this.cart.update((c) => [
      ...c,
      { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, cantidad: 1 },
    ]);
  }

  setCantidad(i: number, v: number): void {
    this.cart.update((c) => c.map((x, idx) => (idx === i ? { ...x, cantidad: Math.max(0, v || 0) } : x)));
  }

  remove(i: number): void {
    this.cart.update((c) => c.filter((_, idx) => idx !== i));
  }

  async addFoto(): Promise<void> {
    if (this.capturing()) return;
    this.capturing.set(true);
    try {
      const photo = await this.camera.takePhoto();
      if (photo) {
        const old = this.foto();
        if (old) URL.revokeObjectURL(old.previewUrl);
        this.foto.set(photo);
      }
    } finally {
      this.capturing.set(false);
    }
  }

  get online(): boolean {
    return this.network.online();
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige la bodega.');
      return;
    }
    const items = this.cart().filter((c) => c.cantidad > 0);
    if (!items.length) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.inventario.enqueueSalida({
        bodegaId: this.bodegaId(),
        proyectoId: null,
        motivo: 'Consumo en obra',
        items: items.map((c) => ({ articulo_id: c.articulo_id, cantidad: c.cantidad })),
        foto: this.foto()?.blob ?? null,
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/inventario'], { replaceUrl: true });
  }
}
