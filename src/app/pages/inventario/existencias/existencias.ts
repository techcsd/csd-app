import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { InventarioService } from '../../../core/services/inventario.service';
import { Bodega, CategoriaInv, Existencia, esArticuloExterno, propiedadLabel } from '../../../core/models/inventario.model';

/** Z18 — un grupo de existencias por categoría (sección colapsable). */
interface GrupoExistencia {
  key: string; // id de categoría como string ('sin' para las que no tienen)
  nombre: string;
  destacada: boolean;
  items: Existencia[];
  total: number; // nº de artículos del grupo (tras el filtro)
}

const SIN_CATEGORIA_KEY = 'sin';

/** Consult stock for a bodega, grouped by category (Z18) with tolerant search. */
@Component({
  selector: 'app-existencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, DecimalPipe, CollapsibleSelect],
  templateUrl: './existencias.html',
  styleUrl: './existencias.scss',
})
export class ExistenciasPage {
  private inventario = inject(InventarioService);
  private location = inject(Location);
  private router = inject(Router);

  readonly propiedadLabel = propiedadLabel; // Z16
  esExterno(e: Existencia): boolean {
    return esArticuloExterno(e.propiedad);
  }

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  existencias = signal<Existencia[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  query = signal('');
  loading = signal(false);

  /** Z18 — categorías colapsadas manualmente por el usuario (por key). */
  private colapsadas = signal<Set<string>>(new Set());

  /** Existencias tras el buscador (filtra a TRAVÉS de todas las categorías). */
  private filtered = computed(() => {
    const q = this.query().toLowerCase().trim();
    if (!q) return this.existencias();
    return this.existencias().filter(
      (e) => e.nombre.toLowerCase().includes(q) || e.codigo.toLowerCase().includes(q),
    );
  });

  /** ¿hay una búsqueda activa? (con búsqueda, los grupos van expandidos). */
  buscando = computed(() => this.query().trim().length > 0);

  /** Z18 — existencias agrupadas por categoría, destacadas primero, orden del
   *  catálogo; "Sin categoría" al final. Solo grupos con resultados. */
  grupos = computed<GrupoExistencia[]>(() => {
    const cats = [...this.categorias()].sort(
      (a, b) => Number(b.destacada) - Number(a.destacada) || a.orden - b.orden,
    );
    const porCat = new Map<string, Existencia[]>();
    for (const e of this.filtered()) {
      const key = e.categoria_id != null ? String(e.categoria_id) : SIN_CATEGORIA_KEY;
      const arr = porCat.get(key);
      if (arr) arr.push(e);
      else porCat.set(key, [e]);
    }
    const out: GrupoExistencia[] = [];
    for (const c of cats) {
      const items = porCat.get(String(c.id));
      if (!items?.length) continue;
      items.sort((a, b) => a.nombre.localeCompare(b.nombre));
      out.push({ key: String(c.id), nombre: c.nombre, destacada: c.destacada, items, total: items.length });
    }
    const sin = porCat.get(SIN_CATEGORIA_KEY);
    if (sin?.length) {
      sin.sort((a, b) => a.nombre.localeCompare(b.nombre));
      out.push({ key: SIN_CATEGORIA_KEY, nombre: 'Sin categoría', destacada: false, items: sin, total: sin.length });
    }
    return out;
  });

  /** Nº total de artículos mostrados (tras el filtro). */
  totalMostrado = computed(() => this.filtered().length);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const [b, cats] = await Promise.all([
      this.inventario.getBodegas(),
      this.inventario.getCategorias().catch(() => []),
    ]);
    this.bodegas.set(b);
    this.categorias.set(cats);
    if (b.length === 1) {
      this.bodegaId.set(b[0].id);
      await this.loadStock();
    }
  }

  async onBodega(id: string): Promise<void> {
    this.bodegaId.set(id);
    this.colapsadas.set(new Set());
    await this.loadStock();
  }

  private async loadStock(): Promise<void> {
    if (!this.bodegaId()) return;
    this.loading.set(true);
    try {
      this.existencias.set(await this.inventario.getExistencias(this.bodegaId()));
    } finally {
      this.loading.set(false);
    }
  }

  /** Z18 — ¿el grupo está abierto? (con búsqueda activa, siempre abierto). */
  abierto(key: string): boolean {
    if (this.buscando()) return true;
    return !this.colapsadas().has(key);
  }

  /** Z18 — abre/cierra una sección de categoría. */
  toggle(key: string): void {
    if (this.buscando()) return; // durante la búsqueda no se colapsa
    this.colapsadas.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** Z17 — abre el detalle del artículo (con el almacén elegido para el stock). */
  abrirArticulo(e: Existencia): void {
    void this.router.navigate(['/inventario/articulo', e.articulo_id], {
      queryParams: { bodega: this.bodegaId() || null },
    });
  }

  back(): void {
    this.location.back();
  }
}
