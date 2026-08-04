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
import { InventarioService } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { ShareSheet } from '../../../shared/ui/share-sheet/share-sheet';
import type { ExportDoc } from '../../../core/services/export.service';
import { formatFechaMedia } from '../../../core/util/fecha';

interface GrupoResumen {
  categoria: string;
  lineas: CartLinea[];
}

/** Estado serializable del formulario (regla 4 — autosave/borrador). */
interface SalidaDraft {
  bodegaId: string;
  notas: string;
  cart: CartLinea[];
  destinoId: string;
}

/** W8 — stock en vivo por artículo. null = no verificado (offline/error). */
type StockInfo = { cantidad: number; unidad: string } | null;

/** Salida de material por el patrón de HOJAS: selección → resumen → éxito. */
@Component({
  selector: 'app-salida',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectorCategorias, CollapsibleSelect, ConfirmDialog, PhotoSlot, SignaturePad, WizardFooter, ShareSheet],
  templateUrl: './salida.html',
  styleUrl: './salida.scss',
})
export class SalidaPage implements OnDestroy {
  private inventario = inject(InventarioService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  private readonly clave = 'inventario:salida';
  private hydrated = false;

  hoja = signal<'seleccion' | 'resumen' | 'exito'>('seleccion');

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  loadingCat = signal(true); // V7 — shimmer while el catálogo carga
  notas = signal('');
  foto = signal<CapturedPhoto | null>(null);
  // AF10 — firma de quien ENTREGA el material (obligatoria al confirmar).
  private sig = viewChild(SignaturePad);
  firmaLista = signal(false);
  firmaBlob = signal<Blob | null>(null);
  submitting = signal(false);
  confirmSalir = signal(false);
  // W8 — destino (obra) opcional: "¿Hacia dónde va?".
  obras = signal<{ id: string; nombre: string }[]>([]);
  destinoId = signal('');
  // W8 — stock en vivo por artículo (mapa articulo_id → info) + estado de carga.
  stockMap = signal<Record<string, StockInfo>>({});
  stockLoading = signal(false);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => [
    { id: '', label: 'Consumo en obra (sin destino)' },
    ...this.obras().map((o) => ({ id: o.id, label: o.nombre })),
  ]);
  bodegaNombre = computed(() => this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? 'el almacén');

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
    // Regla 4 — autosave: no perder el material capturado si el SO mata la app.
    effect(() => {
      const snap: SalidaDraft = {
        bodegaId: this.bodegaId(),
        notas: this.notas(),
        cart: this.cart(),
        destinoId: this.destinoId(),
      };
      if (!this.hydrated || this.submitting() || this.hoja() === 'exito') return;
      if (!snap.cart.length) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'salida',
        etiqueta: 'Salida de material',
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
        this.inventario.getObrasConBodega().catch(() => []),
      ]);
      this.bodegas.set(b);
      this.articulos.set(a);
      this.categorias.set(cat);
      this.obras.set(obras.map((o) => ({ id: o.id, nombre: o.nombre })));
      if (b.length === 1) this.bodegaId.set(b[0].id);
    } finally {
      this.loadingCat.set(false);
    }
    await this.restoreDraft();
  }

  private async restoreDraft(): Promise<void> {
    const d = await this.borrador.load<SalidaDraft>(this.clave);
    if (d) {
      if (d.bodegaId) this.bodegaId.set(d.bodegaId);
      this.notas.set(d.notas ?? '');
      this.cart.set(d.cart ?? []);
      this.destinoId.set(d.destinoId ?? '');
    }
    this.hydrated = true;
  }

  // ── W8 — stock en vivo ──
  /** Refresca el stock de cada artículo del carrito en la bodega elegida. */
  async refreshStocks(): Promise<void> {
    const bodega = this.bodegaId();
    const items = this.cart();
    if (!bodega || !items.length || !this.network.online()) {
      this.stockMap.set({}); // offline / sin bodega → "sin verificar"
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

  /** Info de stock de una línea (undefined si aún no se consultó). */
  stockDe(articuloId: string | null | undefined): StockInfo | undefined {
    if (!articuloId) return undefined;
    return this.stockMap()[articuloId];
  }
  /** true si la cantidad pedida supera el stock verificado. */
  excede(l: CartLinea): boolean {
    const s = this.stockDe(l.articulo_id);
    return !!s && l.cantidad > s.cantidad;
  }
  /** Ajusta la línea al stock disponible (cap sugerido). */
  ajustarAlStock(l: CartLinea): void {
    const s = this.stockDe(l.articulo_id);
    if (s) this.setCantidad(l.articulo_id!, s.cantidad);
  }
  /** ¿Hay alguna línea que exceda el stock verificado? */
  hayExceso = computed(() => this.cart().some((l) => this.excede(l)));
  /** Z19b — la foto de evidencia es OBLIGATORIA (mínimo 1). */
  faltaFoto = computed(() => !this.foto());
  /** AF10 — la firma de quien entrega es OBLIGATORIA. */
  faltaFirma = computed(() => !this.firmaLista());

  // ── Navegación entre hojas ──
  irResumen(): void {
    this.hoja.set('resumen');
    void this.refreshStocks(); // W8 — cargar stock al revisar
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

  // B5 — foto opcional con el componente PhotoSlot compartido (no botón plano).
  onFoto(photo: CapturedPhoto): void {
    this.foto.set(photo);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

  /** AF10 — firma de quien entrega capturada en el pad. */
  async onFirmaChanged(has: boolean): Promise<void> {
    this.firmaLista.set(has);
    this.firmaBlob.set(has ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  // ── Confirmar ──
  /** W8 — al cambiar de almacén en el resumen, re-consultar el stock. */
  setBodega(id: string): void {
    this.bodegaId.set(id);
    void this.refreshStocks();
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
    // Z19b — evidencia obligatoria (el server la exige; validamos antes de enviar).
    if (this.faltaFoto()) {
      this.toast.error('Agrega una foto de evidencia antes de confirmar.');
      return;
    }
    // AF10 — firma de quien entrega obligatoria.
    if (this.faltaFirma() || !this.firmaBlob()) {
      this.toast.error('Falta la firma de quien entrega.');
      return;
    }
    this.submitting.set(true);
    try {
      // W8 — validación previa al éxito (online): confirmar existencias antes de
      // encolar. Si el server rechaza igual (carrera), el pendiente mostrará el
      // error estructurado (FASE 1). Offline → no bloquear (se valida al drenar).
      if (this.network.online()) {
        await this.refreshStocks();
        const excedido = this.cart().find((l) => this.excede(l));
        if (excedido) {
          const s = this.stockDe(excedido.articulo_id);
          this.toast.error(`No hay suficiente "${excedido.nombre}": solo hay ${s?.cantidad ?? 0} ${s?.unidad ?? ''}.`);
          this.submitting.set(false);
          return;
        }
      }
      await this.inventario.enqueueSalida({
        bodegaId: this.bodegaId(),
        proyectoId: this.destinoId() || null, // W8 — destino (obra) si se eligió
        motivo: this.notas().trim() || 'Consumo en obra',
        items: items.map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad, talla: l.talla ?? null })),
        foto: this.foto()?.blob ?? null,
        firma: this.firmaBlob(), // AF10
      });
      void this.autosave.discard(this.clave); // borrador enviado → limpiar
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      this.submitting.set(false);
    }
  }

  // ── Compartir (Y3 — PDF o Excel, no texto plano) ──
  shareOpen = signal(false);

  /** Documento exportable (una tabla con categoría/artículo/cantidad/unidad). */
  shareDoc = computed<ExportDoc>(() => {
    const alm = this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—';
    const destino = this.obras().find((o) => o.id === this.destinoId())?.nombre;
    const meta = [
      { label: 'Almacén', value: alm },
      { label: 'Fecha', value: formatFechaMedia(new Date().toISOString()) },
      ...(destino ? [{ label: 'Destino', value: destino }] : []),
      ...(this.notas().trim() ? [{ label: 'Nota', value: this.notas().trim() }] : []),
    ];
    const rows = this.grupos().flatMap((g) =>
      g.lineas.map((l) => [g.categoria, `${l.nombre}${l.talla ? ` (Talla ${l.talla})` : ''}`, l.cantidad, l.unidad]),
    );
    return {
      title: 'Salida de material',
      filenameBase: 'salida-material',
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
    this.notas.set('');
    this.foto.set(null);
    this.firmaLista.set(false);
    this.firmaBlob.set(null);
    this.destinoId.set('');
    this.stockMap.set({});
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
