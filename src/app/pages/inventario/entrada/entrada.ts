import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';
import { SelectorCategorias } from '../../../shared/ui/selector-categorias/selector-categorias';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { ShareSheet } from '../../../shared/ui/share-sheet/share-sheet';
import { QtyInput } from '../../../shared/ui/qty-input/qty-input';
import type { ExportDoc } from '../../../core/services/export.service';
import { formatFechaMedia } from '../../../core/util/fecha';

interface GrupoResumen {
  categoria: string;
  lineas: CartLinea[];
}

/** Estado serializable del formulario (regla 4 — autosave/borrador). */
interface EntradaDraft {
  bodegaId: string;
  motivo: string;
  motivoOtro: string;
  obraOrigenId: string;
  descontarObra: boolean;
  cart: CartLinea[];
}

/** Entrada de material por el patrón de HOJAS: selección → resumen → éxito. */
@Component({
  selector: 'app-entrada',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectorCategorias, CollapsibleSelect, ConfirmDialog, PhotoSlot, SignaturePad, WizardFooter, ShareSheet, QtyInput],
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
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  private readonly clave = 'inventario:entrada';
  private hydrated = false;

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
  // AF10 — firma de quien RECIBE (no aplica a la devolución de obra).
  private sig = viewChild(SignaturePad);
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  submitting = signal(false);
  confirmSalir = signal(false);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  bodegaNombre = computed(() => this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? 'el almacén');
  /** Z19b — evidencia OBLIGATORIA en la entrada normal (la devolución de obra es
   *  un traspaso atómico por RPC sin foto, así que ahí no aplica). */
  faltaFoto = computed(() => !this.esDevolucion() && !this.foto());
  /** AF10 — firma de quien recibe, obligatoria en la entrada normal (no devolución). */
  faltaFirma = computed(() => !this.esDevolucion() && !this.firmaLista());

  // W8 — stock en vivo (informativo: la entrada suma al stock actual).
  stockMap = signal<Record<string, { cantidad: number; unidad: string } | null>>({});
  stockLoading = signal(false);

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
    // Regla 4 — autosave: si el SO mata la app (picker de cámara MIUI, etc.) el
    // material capturado no se pierde. Persiste el estado serializable (no la foto).
    effect(() => {
      const snap: EntradaDraft = {
        bodegaId: this.bodegaId(),
        motivo: this.motivo(),
        motivoOtro: this.motivoOtro(),
        obraOrigenId: this.obraOrigenId(),
        descontarObra: this.descontarObra(),
        cart: this.cart(),
      };
      if (!this.hydrated || this.submitting() || this.hoja() === 'exito') return;
      if (!snap.cart.length) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'entrada',
        etiqueta: 'Entrada de material',
        ruta: this.location.path(),
      });
    });
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
    await this.restoreDraft();
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<EntradaDraft>(this.clave);
    if (d) {
      if (d.bodegaId) this.bodegaId.set(d.bodegaId);
      this.motivo.set(d.motivo ?? '');
      this.motivoOtro.set(d.motivoOtro ?? '');
      this.obraOrigenId.set(d.obraOrigenId ?? '');
      this.descontarObra.set(d.descontarObra ?? false);
      this.cart.set(d.cart ?? []);
    }
    this.hydrated = true;
  }

  irResumen(): void {
    this.hoja.set('resumen');
    void this.refreshStocks(); // W8
  }

  volverSeleccion(): void {
    this.hoja.set('seleccion');
  }

  // W8 — stock en vivo (informativo).
  setBodega(id: string): void {
    this.bodegaId.set(id);
    void this.refreshStocks();
  }
  async refreshStocks(): Promise<void> {
    const bodega = this.bodegaId();
    const items = this.cart();
    if (!bodega || !items.length || !this.network.online()) {
      this.stockMap.set({});
      return;
    }
    this.stockLoading.set(true);
    try {
      const entries = await Promise.all(
        items.map(async (l) => [l.articulo_id!, await this.inventario.stockArticuloBodega(l.articulo_id!, bodega)] as const),
      );
      this.stockMap.set(Object.fromEntries(entries));
    } finally {
      this.stockLoading.set(false);
    }
  }
  stockDe(articuloId: string | null | undefined): { cantidad: number; unidad: string } | null | undefined {
    if (!articuloId) return undefined;
    return this.stockMap()[articuloId];
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

  // AX7 — SIN `.filter(cant > 0)`: vaciar la cantidad ya no borra el item (eso
  // es la ✕). El qty-input nunca emite vacío; el submit ya guarda los válidos.
  setCantidad(articuloId: string, v: number): void {
    const cant = Math.max(0, v || 0);
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l)),
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

  /** AF10 — firma de quien recibe capturada en el pad. */
  async onFirmaChanged(has: boolean): Promise<void> {
    this.firmaLista.set(has);
    this.firmaBlob.set(has ? ((await this.sig()?.toBlob()) ?? null) : null);
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
    // Z19b — evidencia obligatoria en la entrada normal (no en devolución de obra).
    if (this.faltaFoto()) {
      this.toast.error('Agrega una foto de evidencia antes de confirmar.');
      return;
    }
    // AF10 — firma de quien recibe obligatoria en la entrada normal.
    if (this.faltaFirma() || (!this.esDevolucion() && !this.firmaBlob())) {
      this.toast.error('Falta la firma de quien recibe.');
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
          firma: this.firmaBlob(), // AF10
        });
      }
      void this.autosave.discard(this.clave); // borrador enviado → limpiar
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

  // ── Compartir (Y3 — PDF o Excel, no texto plano) ──
  shareOpen = signal(false);

  shareDoc = computed<ExportDoc>(() => {
    const alm = this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—';
    const ref = this.referenciaEfectiva();
    const meta = [
      { label: 'Almacén', value: alm },
      { label: 'Fecha', value: formatFechaMedia(new Date().toISOString()) },
      ...(ref ? [{ label: '¿De dónde viene?', value: ref }] : []),
    ];
    const rows = this.grupos().flatMap((g) =>
      g.lineas.map((l) => [g.categoria, `${l.nombre}${l.talla ? ` (Talla ${l.talla})` : ''}`, l.cantidad, l.unidad]),
    );
    return {
      title: 'Entrada de material',
      filenameBase: 'entrada-material',
      meta,
      table: { columns: ['Categoría', 'Artículo', 'Cantidad', 'Unidad'], rows, colWeights: [3, 5, 1.5, 1.5] },
      footer: `Total: ${this.totalItems()} artículo(s)`,
    };
  });

  compartir(): void {
    if (!this.cart().length) {
      this.toast.error('No hay material para compartir.');
      return;
    }
    this.shareOpen.set(true);
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
    this.firmaLista.set(false);
    this.firmaBlob.set(null);
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
