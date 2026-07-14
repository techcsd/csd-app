import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SelectorCategorias } from '../../../shared/ui/selector-categorias/selector-categorias';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { compartirTexto } from '../../../core/util/share';

interface GrupoResumen {
  categoria: string;
  lineas: CartLinea[];
}

/** Salida de material por el patrón de HOJAS: selección → resumen → éxito. */
@Component({
  selector: 'app-salida',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectorCategorias, SelectList, ConfirmDialog],
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

  hoja = signal<'seleccion' | 'resumen' | 'exito'>('seleccion');

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  notas = signal('');
  foto = signal<CapturedPhoto | null>(null);
  capturing = signal(false);
  submitting = signal(false);
  confirmSalir = signal(false);
  sharing = signal(false);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));

  grupos = computed<GrupoResumen[]>(() => {
    const nombre = new Map(this.categorias().map((c) => [c.id, c.nombre]));
    const byCat = new Map<string, CartLinea[]>();
    for (const l of this.cart()) {
      const key = l.categoria_id != null ? nombre.get(l.categoria_id) ?? 'Otros' : 'Sin categoría';
      const arr = byCat.get(key) ?? [];
      arr.push(l);
      byCat.set(key, arr);
    }
    return [...byCat.entries()].map(([categoria, lineas]) => ({ categoria, lineas }));
  });

  totalItems = computed(() => this.cart().length);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [b, a, cat] = await Promise.all([
      this.inventario.getBodegas(),
      this.inventario.getArticulos(),
      this.inventario.getCategorias(),
    ]);
    this.bodegas.set(b);
    this.articulos.set(a);
    this.categorias.set(cat);
    if (b.length === 1) this.bodegaId.set(b[0].id);
  }

  // ── Navegación entre hojas ──
  irResumen(): void {
    this.hoja.set('resumen');
  }

  volverSeleccion(): void {
    this.hoja.set('seleccion');
  }

  intentarSalir(): void {
    if (this.cart().length > 0) this.confirmSalir.set(true);
    else this.finish();
  }

  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.finish();
  }

  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  // ── Edición en el resumen ──
  ajustar(articuloId: string, delta: number): void {
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.max(0, l.cantidad + delta) } : l))
        .filter((l) => l.cantidad > 0),
    );
  }

  setCantidad(articuloId: string, v: number): void {
    const cant = Math.max(0, v || 0);
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l))
        .filter((l) => l.cantidad > 0),
    );
  }

  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
    if (!this.cart().length) this.hoja.set('seleccion');
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

  // ── Confirmar ──
  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén.');
      return;
    }
    const items = this.cart().filter((l) => l.cantidad > 0);
    if (!items.length) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.inventario.enqueueSalida({
        bodegaId: this.bodegaId(),
        proyectoId: null,
        motivo: this.notas().trim() || 'Consumo en obra',
        items: items.map((l) => ({ articulo_id: l.articulo_id, cantidad: l.cantidad })),
        foto: this.foto()?.blob ?? null,
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  // ── Compartir ──
  private resumenTexto(): string {
    const alm = this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—';
    const fecha = new Date().toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
    const lineas = this.grupos()
      .map(
        (g) =>
          `*${g.categoria}*\n` +
          g.lineas.map((l) => `  • ${l.nombre}: ${l.cantidad} ${l.unidad}`).join('\n'),
      )
      .join('\n');
    const notas = this.notas().trim() ? `\nNota: ${this.notas().trim()}` : '';
    return `🧾 *Salida de material — CSD*\nAlmacén: ${alm}\nFecha: ${fecha}${notas}\n\n${lineas}\n\nTotal: ${this.totalItems()} artículo(s)`;
  }

  async compartir(): Promise<void> {
    if (this.sharing()) return;
    this.sharing.set(true);
    try {
      const res = await compartirTexto('Salida de material', this.resumenTexto());
      if (res.fallback) this.toast.success('Resumen copiado. Pégalo en WhatsApp.');
    } catch {
      this.toast.error('No se pudo compartir.');
    } finally {
      this.sharing.set(false);
    }
  }

  nuevoRegistro(): void {
    const old = this.foto();
    if (old) URL.revokeObjectURL(old.previewUrl);
    this.cart.set([]);
    this.notas.set('');
    this.foto.set(null);
    this.hoja.set('seleccion');
  }

  back(): void {
    this.location.back();
  }
  finish(): void {
    void this.router.navigate(['/inventario'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
