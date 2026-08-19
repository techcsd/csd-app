import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
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
  imports: [FormsModule, DecimalPipe],
  templateUrl: './articulo-picker.html',
  styleUrl: './articulo-picker.scss',
})
export class ArticuloPicker {
  articulos = input<ArticuloCat[]>([]);
  categorias = input<CategoriaInv[]>([]);
  exclude = input<string[]>([]);
  /** AE — modo solo-buscador: sin grilla de categorías; el usuario teclea y elige.
   *  Con la búsqueda vacía muestra un hint (no vuelca todo el catálogo). */
  soloBuscador = input<boolean>(false);
  /** AO3 — stock disponible por artículo del almacén de origen. `null` = no verificar
   *  (offline / origen sin stock, ej. ferretería) → no se marca ni bloquea nada. Con
   *  mapa presente, los artículos en 0 salen deshabilitados y se muestra el disponible. */
  stock = input<Record<string, number> | null>(null);
  picked = output<ArticuloCat>();

  /** AO3 — disponible del artículo; null si no se pasó mapa (no marcar). Un artículo
   *  ausente del mapa con stock cargado = 0 (el almacén no lo tiene). */
  stockDe(id: string): number | null {
    const m = this.stock();
    if (!m) return null;
    return id in m ? m[id] : 0;
  }
  /** AO3 — sin existencia conocida (0) → no se puede sacar. */
  sinStock(a: ArticuloCat): boolean {
    const s = this.stockDe(a.id);
    return s !== null && s <= 0;
  }
  /** AO3 — bloqueo inmediato: no emite un artículo sin stock. */
  pick(a: ArticuloCat): void {
    if (this.sinStock(a)) return;
    this.picked.emit(a);
  }

  query = signal('');
  /** Selected category id, or null while showing the category grid. */
  categoriaSel = signal<number | null>(null);

  private disponibles = computed(() => {
    const ex = new Set(this.exclude());
    // AP3 — con mapa de stock presente, los artículos en 0 se OCULTAN del selector
    // (antes solo se deshabilitaban). Sin mapa (conteo/pedir/ferretería) no se filtra.
    return this.articulos().filter((a) => !ex.has(a.id) && !this.sinStock(a));
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

  /** AW6 — normaliza para buscar: minúsculas + sin acentos (el usuario teclea sin tildes). */
  private norm(s: string | null | undefined): string {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  visible = computed(() => {
    const q = this.norm(this.query().trim());
    const items = this.disponibles();
    if (q) {
      // AW6 — búsqueda más amigable: sin acentos y por TODAS las palabras escritas
      // (orden libre): "tubo pvc" matchea "PVC tubería"; también por código.
      const tokens = q.split(/\s+/).filter(Boolean);
      return items.filter((a) => {
        const nombre = this.norm(a.nombre);
        const codigo = this.norm(a.codigo);
        return tokens.every((t) => nombre.includes(t) || codigo.includes(t));
      });
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
