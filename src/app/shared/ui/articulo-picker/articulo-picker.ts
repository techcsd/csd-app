import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';

const SIN_CATEGORIA = -1;

/**
 * Browse-and-tap material picker (R16). Categories come first — the daily ones
 * (destacadas: Clavos/Madera/Acero…) at the top; the rest behind their own
 * category. Tap a category to see its articles; search always spans everything.
 * Already-added items are hidden.
 */
@Component({
  selector: 'app-articulo-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './articulo-picker.html',
  styleUrl: './articulo-picker.scss',
})
export class ArticuloPicker {
  articulos = input<ArticuloCat[]>([]);
  categorias = input<CategoriaInv[]>([]);
  exclude = input<string[]>([]);
  picked = output<ArticuloCat>();

  query = signal('');
  /** Selected category id, or null while showing the category grid. */
  categoriaSel = signal<number | null>(null);

  private disponibles = computed(() => {
    const ex = new Set(this.exclude());
    return this.articulos().filter((a) => !ex.has(a.id));
  });

  /** Categories to show as chips: destacadas first, then by orden. */
  categoriaChips = computed(() => {
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const withCat = cats.map((c) => ({ id: c.id, nombre: c.nombre, destacada: c.destacada }));
    if (this.disponibles().some((a) => a.categoria_id == null)) {
      withCat.push({ id: SIN_CATEGORIA, nombre: 'Sin categoría', destacada: false });
    }
    return withCat;
  });

  private childrenOf(catId: number): Set<number> {
    return new Set(this.categorias().filter((c) => c.padre_id === catId).map((c) => c.id));
  }

  nombreCategoria = computed(
    () => this.categorias().find((c) => c.id === this.categoriaSel())?.nombre
      ?? (this.categoriaSel() === SIN_CATEGORIA ? 'Sin categoría' : ''),
  );

  /** Whether we drive the UI by categories (only when categories were provided). */
  hasCategorias = computed(() => this.categorias().length > 0);

  visible = computed(() => {
    const q = this.query().toLowerCase().trim();
    const items = this.disponibles();
    if (q) {
      return items.filter(
        (a) => a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q),
      );
    }
    // No categories provided → flat list (conteo/pedir keep their old behavior).
    if (!this.hasCategorias()) return items;
    const sel = this.categoriaSel();
    if (sel == null) return [];
    if (sel === SIN_CATEGORIA) return items.filter((a) => a.categoria_id == null);
    const kids = this.childrenOf(sel);
    return items.filter((a) => a.categoria_id === sel || (a.categoria_id != null && kids.has(a.categoria_id)));
  });

  /** How many pickable articles a category chip holds (skips empties). */
  conteoCategoria(catId: number): number {
    const items = this.disponibles();
    if (catId === SIN_CATEGORIA) return items.filter((a) => a.categoria_id == null).length;
    const kids = this.childrenOf(catId);
    return items.filter((a) => a.categoria_id === catId || (a.categoria_id != null && kids.has(a.categoria_id))).length;
  }

  seleccionarCategoria(catId: number): void {
    this.categoriaSel.set(catId);
  }

  volverCategorias(): void {
    this.categoriaSel.set(null);
    this.query.set('');
  }
}
