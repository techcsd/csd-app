import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ArticuloBusqueda, ArticuloCat, CategoriaInv } from '../../../core/models/inventario.model';
import { CatalogoFiltroStore } from './catalogo-filtro.store';

/** Normaliza para búsqueda tolerante a acentos/mayúsculas. */
function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/** Cuántas categorías caben como chips antes de pasar al selector en hoja (AU11). */
const MAX_CHIPS = 5;

/**
 * AS20/AU11/AU12 — Catálogo de artículos (SOLO lectura) en la app.
 *
 * Lista global del catálogo (no por almacén): buscador por nombre, código y APODO
 * (AU12, RPC `buscar_articulos` alias-aware), filtro por categoría con selector en
 * hoja (AU11, chips solo si son pocas), miniatura, y tap → detalle. Reutiliza el
 * catálogo cacheado offline (`getArticulos`) → navega sin señal; la búsqueda por
 * apodo/typo requiere conexión (añade resultados sobre los locales).
 */
@Component({
  selector: 'app-catalogo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, CollapsibleSelect],
  templateUrl: './catalogo.html',
  styleUrl: './catalogo.scss',
})
export class CatalogoPage {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private net = inject(NetworkService);
  private location = inject(Location);
  private router = inject(Router);
  private store = inject(CatalogoFiltroStore);

  /** AS20 — puede crear artículos (admin o módulo inventario). */
  puedeCrear = this.ctx.puedeOperarSubmodulo.bind(this.ctx);
  nuevo(): void {
    void this.router.navigate(['/inventario/articulo-nuevo']);
  }

  loading = signal(true);
  private articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);

  // AU11 — estado del filtro persistido (sobrevive al ir/volver del detalle).
  query = this.store.query;
  categoriaSel = this.store.categoria;

  // AU12 — resultados alias-aware del server (apodo/código/typo), fusionados al buscar.
  private serverHits = signal<ArticuloBusqueda[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  /** Categorías con al menos un artículo, destacadas primero. */
  categoriaChips = computed(() => {
    const conArt = new Set(this.articulos().map((a) => a.categoria_id));
    return [...this.categorias()]
      .filter((c) => conArt.has(c.id))
      .sort((a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden);
  });

  /** AU11 — con muchas categorías, se usa el selector en hoja en vez de los chips. */
  usarSelector = computed(() => this.categoriaChips().length > MAX_CHIPS);

  /** AU11 — opciones del selector en hoja (con "Todas" para quitar el filtro). */
  categoriaOptions = computed(() => [
    { id: '', label: 'Todas las categorías' },
    ...this.categoriaChips().map((c) => ({ id: String(c.id), label: c.nombre })),
  ]);
  categoriaSelId = computed(() => (this.categoriaSel() != null ? String(this.categoriaSel()) : ''));
  categoriaSelNombre = computed(() => this.nombreCategoria(this.categoriaSel()));

  nombreCategoria = (id: number | null): string =>
    id == null ? 'Sin categoría' : this.categorias().find((c) => c.id === id)?.nombre ?? 'Sin categoría';

  /** AU12 — apodo por el que coincidió un resultado del server (o null). */
  apodoMatch(a: ArticuloCat): string | null {
    const b = a as ArticuloBusqueda;
    return b.match_por === 'apodo' && b.match_alias ? b.match_alias : null;
  }

  /** Artículos tras buscador (nombre/código/apodo) + filtro de categoría. */
  visible = computed<ArticuloCat[]>(() => {
    const cat = this.categoriaSel();
    const enCat = (a: ArticuloCat) => cat == null || a.categoria_id === cat;
    const palabras = norm(this.query()).split(/\s+/).filter(Boolean);

    if (!palabras.length) {
      return this.articulos().filter(enCat);
    }
    // Local: nombre + código, sin acentos, por todas las palabras.
    const locales = this.articulos().filter((a) => {
      if (!enCat(a)) return false;
      const heno = norm(`${a.nombre} ${a.codigo ?? ''}`);
      return palabras.every((p) => heno.includes(p));
    });
    // AU12 — completa con los hits del server (apodo/typo/código) que el filtro local
    // no cazó, respetando el filtro de categoría.
    const ya = new Set(locales.map((a) => a.id));
    const extra = this.serverHits().filter((a) => !ya.has(a.id) && enCat(a));
    return [...locales, ...extra];
  });

  total = computed(() => this.visible().length);

  constructor() {
    void this.init();
    // AU12 — búsqueda alias-aware del server con debounce (online, ≥2 chars). Aditiva:
    // sin red o con menos de 2 chars, serverHits queda vacío y solo cuenta lo local.
    effect(() => {
      const q = this.query().trim();
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (q.length < 2 || !this.net.online()) {
        this.serverHits.set([]);
        return;
      }
      const seq = ++this.searchSeq;
      this.searchTimer = setTimeout(() => {
        void this.inventario
          .buscarArticulos(q, 30)
          .then((hits) => {
            if (seq === this.searchSeq) this.serverHits.set(hits);
          })
          .catch(() => {
            if (seq === this.searchSeq) this.serverHits.set([]);
          });
      }, 300);
    });
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

  /** Chips: alterna el filtro (tocar el activo lo quita). */
  filtrarCategoria(id: number | null): void {
    this.categoriaSel.set(this.categoriaSel() === id ? null : id);
  }

  /** AU11 — selector en hoja: '' = quitar filtro. */
  onCategoriaSel(id: string): void {
    this.categoriaSel.set(id ? Number(id) : null);
  }

  quitarFiltro(): void {
    this.categoriaSel.set(null);
  }

  abrir(a: ArticuloCat): void {
    void this.router.navigate(['/inventario/articulo', a.id]);
  }

  back(): void {
    this.location.back();
  }
}
