import { ChangeDetectionStrategy, Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticuloCat, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';

const SIN_CATEGORIA = -1;

interface CategoriaChip {
  id: number;
  nombre: string;
  destacada: boolean;
  disponibles: number;
  seleccionados: number;
}

/**
 * Reusable category-sheet selector (patrón "HOJAS" del jefe). Two full-screen
 * sheets: (1) categories — destacadas first, each with a badge of items already
 * picked; (2) the tapped category's articles with a − / + stepper. The cart is a
 * two-way `model` so the parent owns it (survives navigating between sheets and
 * can edit it in a later review sheet). Emits `siguiente` / `cancelar`.
 * Generic on purpose: any future multi-select-by-category flow can embed it.
 */
@Component({
  selector: 'app-selector-categorias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './selector-categorias.html',
  styleUrl: './selector-categorias.scss',
})
export class SelectorCategorias {
  articulos = input<ArticuloCat[]>([]);
  categorias = input<CategoriaInv[]>([]);
  cart = model<CartLinea[]>([]);

  siguiente = output<void>();
  cancelar = output<void>();

  hoja = signal<'categorias' | 'categoria'>('categorias');
  catSelId = signal<number | null>(null);
  query = signal('');

  totalCarrito = computed(() => this.cart().length);

  private childrenOf(catId: number): Set<number> {
    return new Set(this.categorias().filter((c) => c.padre_id === catId).map((c) => c.id));
  }

  private perteneceA(articulo: ArticuloCat, catId: number): boolean {
    if (catId === SIN_CATEGORIA) return articulo.categoria_id == null;
    if (articulo.categoria_id === catId) return true;
    return articulo.categoria_id != null && this.childrenOf(catId).has(articulo.categoria_id);
  }

  /** Category chips: destacadas first, then by orden; only non-empty ones. */
  chips = computed<CategoriaChip[]>(() => {
    const seleccionadosPorCat = new Map<number, number>();
    for (const l of this.cart()) {
      const cid = l.categoria_id ?? SIN_CATEGORIA;
      seleccionadosPorCat.set(cid, (seleccionadosPorCat.get(cid) ?? 0) + 1);
    }
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const out: CategoriaChip[] = cats.map((c) => ({
      id: c.id,
      nombre: c.nombre,
      destacada: c.destacada,
      disponibles: this.articulos().filter((a) => this.perteneceA(a, c.id)).length,
      // Selected count must include child categories rolled up under this chip.
      seleccionados: this.contarSeleccionados(c.id),
    }));
    if (this.articulos().some((a) => a.categoria_id == null)) {
      out.push({
        id: SIN_CATEGORIA,
        nombre: 'Sin categoría',
        destacada: false,
        disponibles: this.articulos().filter((a) => a.categoria_id == null).length,
        seleccionados: seleccionadosPorCat.get(SIN_CATEGORIA) ?? 0,
      });
    }
    return out.filter((c) => c.disponibles > 0);
  });

  private contarSeleccionados(catId: number): number {
    return this.cart().filter((l) => {
      const art = this.articulos().find((a) => a.id === l.articulo_id);
      return art ? this.perteneceA(art, catId) : false;
    }).length;
  }

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

  abrirCategoria(catId: number): void {
    this.catSelId.set(catId);
    this.query.set('');
    this.hoja.set('categoria');
  }

  volverCategorias(): void {
    this.hoja.set('categorias');
    this.catSelId.set(null);
  }

  setCantidad(a: ArticuloCat, valor: number): void {
    const cant = Math.max(0, Math.floor((valor || 0) * 100) / 100);
    this.aplicar(a, cant);
  }

  ajustar(a: ArticuloCat, delta: number): void {
    this.aplicar(a, Math.max(0, this.cantidadDe(a.id) + delta));
  }

  private aplicar(a: ArticuloCat, cantidad: number): void {
    this.cart.update((list) => {
      const idx = list.findIndex((l) => l.articulo_id === a.id);
      if (cantidad <= 0) return idx >= 0 ? list.filter((_, i) => i !== idx) : list;
      if (idx >= 0) return list.map((l, i) => (i === idx ? { ...l, cantidad } : l));
      return [
        ...list,
        {
          articulo_id: a.id,
          nombre: a.nombre,
          unidad: a.unidad,
          categoria_id: a.categoria_id,
          cantidad,
        },
      ];
    });
  }

  onSiguiente(): void {
    if (this.totalCarrito() > 0) this.siguiente.emit();
  }

  onCancelar(): void {
    this.cancelar.emit();
  }
}
