import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';

/** Normaliza para búsqueda tolerante a acentos/mayúsculas. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * AS20 — Catálogo de artículos (SOLO lectura) en la app.
 *
 * Lista global del catálogo (no por almacén): buscador por nombre y código,
 * filtro por categoría, miniatura del artículo, y tap → detalle (`articulo/:id`)
 * con stock por almacén + kardex. Reutiliza el catálogo cacheado offline
 * (`InventarioService.getArticulos`) → funciona sin señal. La creación/edición y
 * las fotos son del admin en la web (backend no expuesto a la app todavía).
 */
@Component({
  selector: 'app-catalogo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule],
  templateUrl: './catalogo.html',
  styleUrl: './catalogo.scss',
})
export class CatalogoPage {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private location = inject(Location);
  private router = inject(Router);

  /** AS20 — puede crear artículos (admin o módulo inventario). */
  puedeCrear = this.ctx.puedeOperarSubmodulo.bind(this.ctx);
  nuevo(): void {
    void this.router.navigate(['/inventario/articulo-nuevo']);
  }

  loading = signal(true);
  private articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  query = signal('');
  categoriaSel = signal<number | null>(null); // null = todas

  /** Categorías con al menos un artículo, destacadas primero. */
  categoriaChips = computed(() => {
    const conArt = new Set(this.articulos().map((a) => a.categoria_id));
    return [...this.categorias()]
      .filter((c) => conArt.has(c.id))
      .sort((a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden);
  });

  nombreCategoria = (id: number | null): string =>
    id == null ? 'Sin categoría' : this.categorias().find((c) => c.id === id)?.nombre ?? 'Sin categoría';

  /** Artículos tras buscador (nombre/código, sin acentos, por palabras) + filtro categoría. */
  visible = computed<ArticuloCat[]>(() => {
    const cat = this.categoriaSel();
    const palabras = norm(this.query()).split(/\s+/).filter(Boolean);
    return this.articulos().filter((a) => {
      if (cat != null && a.categoria_id !== cat) return false;
      if (!palabras.length) return true;
      const heno = norm(`${a.nombre} ${a.codigo ?? ''}`);
      return palabras.every((p) => heno.includes(p));
    });
  });

  total = computed(() => this.visible().length);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const [arts, cats] = await Promise.all([
        this.inventario.getArticulos(),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
      ]);
      this.articulos.set(arts);
      this.categorias.set(cats);
    } finally {
      this.loading.set(false);
    }
  }

  filtrarCategoria(id: number | null): void {
    this.categoriaSel.set(this.categoriaSel() === id ? null : id);
  }

  abrir(a: ArticuloCat): void {
    void this.router.navigate(['/inventario/articulo', a.id]);
  }

  back(): void {
    this.location.back();
  }
}
