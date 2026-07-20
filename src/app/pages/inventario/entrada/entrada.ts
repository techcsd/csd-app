import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SelectorCategorias } from '../../../shared/ui/selector-categorias/selector-categorias';
import { SelectList } from '../../../shared/ui/select-list/select-list';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { compartirTexto } from '../../../core/util/share';

interface GrupoResumen {
  categoria: string;
  lineas: CartLinea[];
}

/** Entrada de material por el patrón de HOJAS: selección → resumen → éxito. */
@Component({
  selector: 'app-entrada',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectorCategorias, SelectList, ConfirmDialog, PhotoSlot, WizardFooter],
  templateUrl: './entrada.html',
  styleUrl: '../salida/salida.scss',
})
export class EntradaPage implements OnDestroy {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  readonly motivos = ['Compra local', 'Devolución de obra', 'Sobrante', 'Otro'];

  hoja = signal<'seleccion' | 'resumen' | 'exito'>('seleccion');

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  motivo = signal('');
  motivoOtro = signal(''); // U25 — detalle cuando el motivo es "Otro"

  // P12 — devolución de obra: obra de origen + descontar de su almacén.
  obras = signal<ObraOrigen[]>([]);
  obraOrigenId = signal('');
  descontarObra = signal(false);
  esDevolucion = computed(() => this.motivo() === 'Devolución de obra');
  obraOpts = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  obraSel = computed<ObraOrigen | null>(() => this.obras().find((o) => o.id === this.obraOrigenId()) ?? null);
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  loadingCat = signal(true); // V7 — shimmer while el catálogo carga
  foto = signal<CapturedPhoto | null>(null);
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

  private readonly backHandler = (): boolean => {
    if (this.cart().length > 0) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.init();
    this.navGuard.register(this.backHandler); // U4 — botón físico Android
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loadingCat.set(true);
    try {
      const [b, a, cat, obras] = await Promise.all([
        this.inventario.getBodegas(),
        this.inventario.getArticulos(),
        this.inventario.getCategorias(),
        this.inventario.getObrasConBodega(),
      ]);
      this.bodegas.set(b);
      this.articulos.set(a);
      this.categorias.set(cat);
      this.obras.set(obras);
      if (b.length === 1) this.bodegaId.set(b[0].id);
    } finally {
      this.loadingCat.set(false);
    }
  }

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

  // B5 — foto opcional con el componente PhotoSlot compartido (no botón plano).
  onFoto(photo: CapturedPhoto): void {
    this.foto.set(photo);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

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
    // U25 — si el motivo es "Otro", el detalle es obligatorio y es lo que se envía.
    if (this.motivo() === 'Otro' && !this.motivoOtro().trim()) {
      this.toast.error('Especifica de dónde viene el material.');
      return;
    }
    // P12 — devolución de obra: la obra de origen es obligatoria.
    if (this.esDevolucion() && !this.obraOrigenId()) {
      this.toast.error('Elige la obra de la que viene el material.');
      return;
    }
    this.submitting.set(true);
    try {
      if (this.esDevolucion()) {
        // P12 — traspaso atómico (salida del almacén de la obra + entrada aquí)
        // vía RPC, encolado por outbox. Solo descuenta si la obra tiene almacén.
        await this.inventario.enqueueDevolucionObra({
          bodegaDestinoId: this.bodegaId(),
          origenProyectoId: this.obraOrigenId(),
          descontar: this.descontarObra() && !!this.obraSel()?.tieneBodega,
          referencia: null,
          items: items.map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
        });
      } else {
        await this.inventario.enqueueEntrada({
          bodegaId: this.bodegaId(),
          referencia: this.referenciaEfectiva(),
          // B3/U25 — cuando el origen es "Otro", ese texto libre alimenta otros_valores.
          otroReferencia: this.motivo() === 'Otro' ? this.motivoOtro().trim() || null : null,
          items: items.map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad, talla: l.talla ?? null })),
          foto: this.foto()?.blob ?? null,
        });
      }
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** U25 — "Otro" envía el detalle escrito; los demás motivos, su etiqueta. */
  private referenciaEfectiva(): string | null {
    if (this.motivo() === 'Otro') return this.motivoOtro().trim() || null;
    return this.motivo() || null;
  }

  private resumenTexto(): string {
    const alm = this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—';
    const fecha = new Date().toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
    const lineas = this.grupos()
      .map(
        (g) =>
          `*${g.categoria}*\n` +
          g.lineas.map((l) => `  • ${l.nombre}${l.talla ? ` (Talla ${l.talla})` : ''}: ${l.cantidad} ${l.unidad}`).join('\n'),
      )
      .join('\n');
    const refEfectiva = this.referenciaEfectiva();
    const ref = refEfectiva ? `\n¿De dónde viene?: ${refEfectiva}` : '';
    return `📦 *Entrada de material — CSD*\nAlmacén: ${alm}\nFecha: ${fecha}${ref}\n\n${lineas}\n\nTotal: ${this.totalItems()} artículo(s)`;
  }

  async compartir(): Promise<void> {
    if (this.sharing()) return;
    this.sharing.set(true);
    try {
      const res = await compartirTexto('Entrada de material', this.resumenTexto());
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
    this.motivo.set('');
    this.motivoOtro.set('');
    this.obraOrigenId.set('');
    this.descontarObra.set(false);
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
