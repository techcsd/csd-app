import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticuloCat, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { Skeleton } from '../skeleton/skeleton';

const SIN_CATEGORIA = -1;
/** Custom "Otros" lines get a synthetic id so the cart keys stay unique; the
 *  consuming page maps `otro:*` back to a null articulo_id for the RPC. */
const OTRO_PREFIX = 'otro:';

interface CategoriaChip {
  id: number;
  nombre: string;
  destacada: boolean;
  disponibles: number;
  seleccionados: number;
  esOtros: boolean;
}

/**
 * Reusable category-sheet selector (patrón "HOJAS" del jefe). Two full-screen
 * sheets: (1) categories — destacadas first, each with a badge of items already
 * picked; (2) the tapped category's articles with a − / + stepper. The cart is a
 * two-way `model` so the parent owns it. Emits `siguiente` / `cancelar`.
 *
 * V14: EPP articles flagged `requiere_talla` ask for a size before they enter
 * the cart; packing/brand notes show as a hint. In `requisicion` mode the "Otros"
 * category (08) lets the user describe a material that isn't in the catalog.
 */
@Component({
  selector: 'app-selector-categorias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Skeleton],
  templateUrl: './selector-categorias.html',
  styleUrl: './selector-categorias.scss',
})
export class SelectorCategorias {
  articulos = input<ArticuloCat[]>([]);
  categorias = input<CategoriaInv[]>([]);
  loading = input(false); // V7: shimmer while the catalog loads (no blank grid)
  /** 'requisicion' unlocks the free-text "Otros" flow (V14/08). */
  modo = input<'stock' | 'requisicion'>('stock');
  cart = model<CartLinea[]>([]);

  siguiente = output<void>();
  cancelar = output<void>();

  hoja = signal<'categorias' | 'categoria'>('categorias');
  catSelId = signal<number | null>(null);
  query = signal('');

  // Talla dialog (EPP)
  tallaFor = signal<ArticuloCat | null>(null);
  tallaValor = signal('');
  readonly tallasComunes = ['S', 'M', 'L', 'XL', 'XXL'];

  // "Otros" describe form
  otroDesc = signal('');
  otroUnidad = signal('UND');
  otroCant = signal(1);

  totalCarrito = computed(() => this.cart().length);

  private childrenOf(catId: number): Set<number> {
    return new Set(this.categorias().filter((c) => c.padre_id === catId).map((c) => c.id));
  }

  private perteneceA(articulo: ArticuloCat, catId: number): boolean {
    if (catId === SIN_CATEGORIA) return articulo.categoria_id == null;
    if (articulo.categoria_id === catId) return true;
    return articulo.categoria_id != null && this.childrenOf(catId).has(articulo.categoria_id);
  }

  private esOtros(c: { nombre: string }): boolean {
    return /^otros$/i.test(c.nombre.trim());
  }

  /** Id of the official "Otros" (08) category, if present. */
  otrosCatId = computed(() => this.categorias().find((c) => this.esOtros(c))?.id ?? null);

  /** Custom lines already added under "Otros". */
  otrosLineas = computed(() =>
    this.cart().filter((l) => typeof l.articulo_id === 'string' && l.articulo_id.startsWith(OTRO_PREFIX)),
  );

  /** Category chips: official order (orden), destacadas first; only non-empty —
   *  except "Otros" in requisición mode, which is always offered. */
  chips = computed<CategoriaChip[]>(() => {
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const out: CategoriaChip[] = cats.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      destacada: c.destacada,
      disponibles: this.articulos().filter((a) => this.perteneceA(a, c.id)).length,
      seleccionados: this.contarSeleccionados(c.id),
      esOtros: this.esOtros(c),
    }));
    if (this.articulos().some((a) => a.categoria_id == null)) {
      out.push({
        id: SIN_CATEGORIA,
        nombre: 'Sin categoría',
        destacada: false,
        disponibles: this.articulos().filter((a) => a.categoria_id == null).length,
        seleccionados: this.cart().filter((l) => l.categoria_id == null && !this.esCustom(l)).length,
        esOtros: false,
      });
    }
    // Show categories with articles; keep "Otros" visible in requisición mode.
    return out.filter((c) => c.disponibles > 0 || (c.esOtros && this.modo() === 'requisicion'));
  });

  private esCustom(l: CartLinea): boolean {
    return typeof l.articulo_id === 'string' && l.articulo_id.startsWith(OTRO_PREFIX);
  }

  private contarSeleccionados(catId: number): number {
    return this.cart().filter((l) => {
      if (this.esCustom(l)) return l.categoria_id === catId;
      const art = this.articulos().find((a) => a.id === l.articulo_id);
      return art ? this.perteneceA(art, catId) : false;
    }).length;
  }

  categoriaAbierta = computed(() => this.categorias().find((c) => c.id === this.catSelId()) ?? null);
  esOtrosAbierta = computed(() => {
    const c = this.categoriaAbierta();
    return !!c && this.esOtros(c);
  });

  nombreCategoria = computed(() => {
    const id = this.catSelId();
    if (id === SIN_CATEGORIA) return 'Sin categoría';
    return this.categorias().find((c) => c.id === id)?.nombre ?? '';
  });

  /** Articles of the open category, filtered by the in-category search. */
  articulosVisibles = computed<ArticuloCat[]>(() => {
    const id = this.catSelId();
    if (id == null) return [];
    const q = this.query().toLowerCase().trim();
    return this.articulos()
      .filter((a) => this.perteneceA(a, id))
      .filter((a) => !q || a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q));
  });

  cantidadDe(articuloId: string): number {
    return this.cart().find((l) => l.articulo_id === articuloId)?.cantidad ?? 0;
  }

  tallaDe(articuloId: string): string | null {
    return this.cart().find((l) => l.articulo_id === articuloId)?.talla ?? null;
  }

  abrirCategoria(catId: number): void {
    this.catSelId.set(catId);
    this.query.set('');
    this.resetOtroForm();
    this.hoja.set('categoria');
  }

  volverCategorias(): void {
    this.hoja.set('categorias');
    this.catSelId.set(null);
  }

  // ── Stepper (con talla para EPP) ──
  setCantidad(a: ArticuloCat, valor: number): void {
    const cant = Math.max(0, Math.floor((valor || 0) * 100) / 100);
    if (a.requiere_talla && cant > 0 && !this.tallaDe(a.id)) {
      this.abrirTalla(a);
      return;
    }
    this.aplicar(a, cant, this.tallaDe(a.id));
  }

  ajustar(a: ArticuloCat, delta: number): void {
    const next = Math.max(0, this.cantidadDe(a.id) + delta);
    if (a.requiere_talla && next > 0 && !this.tallaDe(a.id)) {
      this.abrirTalla(a);
      return;
    }
    this.aplicar(a, next, this.tallaDe(a.id));
  }

  private aplicar(a: ArticuloCat, cantidad: number, talla: string | null): void {
    this.cart.update((list) => {
      const idx = list.findIndex((l) => l.articulo_id === a.id);
      if (cantidad <= 0) return idx >= 0 ? list.filter((_, i) => i !== idx) : list;
      if (idx >= 0) return list.map((l, i) => (i === idx ? { ...l, cantidad, talla } : l));
      return [
        ...list,
        {
          articulo_id: a.id,
          nombre: a.nombre,
          unidad: a.unidad,
          categoria_id: a.categoria_id,
          cantidad,
          talla,
        },
      ];
    });
  }

  // ── Talla dialog ──
  abrirTalla(a: ArticuloCat): void {
    this.tallaFor.set(a);
    this.tallaValor.set(this.tallaDe(a.id) ?? '');
  }

  confirmarTalla(): void {
    const a = this.tallaFor();
    const talla = this.tallaValor().trim();
    if (!a || !talla) return;
    const cant = Math.max(1, this.cantidadDe(a.id));
    this.aplicar(a, cant, talla);
    this.tallaFor.set(null);
    this.tallaValor.set('');
  }

  cancelarTalla(): void {
    this.tallaFor.set(null);
    this.tallaValor.set('');
  }

  // ── Otros (free-text) ──
  private resetOtroForm(): void {
    this.otroDesc.set('');
    this.otroUnidad.set('UND');
    this.otroCant.set(1);
  }

  agregarOtro(): void {
    const desc = this.otroDesc().trim();
    const cant = Math.max(1, Math.floor((this.otroCant() || 0) * 100) / 100);
    const catId = this.otrosCatId();
    if (!desc) return;
    this.cart.update((list) => [
      ...list,
      {
        articulo_id: OTRO_PREFIX + crypto.randomUUID(),
        nombre: desc,
        unidad: this.otroUnidad().trim() || 'UND',
        categoria_id: catId,
        cantidad: cant,
        descripcion: desc,
      },
    ]);
    this.resetOtroForm();
  }

  quitarOtro(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  onSiguiente(): void {
    if (this.totalCarrito() > 0) this.siguiente.emit();
  }

  onCancelar(): void {
    this.cancelar.emit();
  }
}
