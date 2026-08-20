import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { InventarioService } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { ArticuloCat, Bodega, CategoriaInv, esArticuloExterno, propiedadLabel } from '../../../core/models/inventario.model';

/** Z17 — detalle de un artículo: foto grande, código, categoría, propiedad,
 *  unidad y stock del almacén elegido. Se abre al tocar un artículo en
 *  existencias / salida / entrada / conduces. */
@Component({
  selector: 'app-articulo-detalle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, Skeleton],
  templateUrl: './articulo-detalle.html',
  styleUrl: './articulo-detalle.scss',
})
export class ArticuloDetallePage {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private router = inject(Router);

  readonly propiedadLabel = propiedadLabel;

  /** AS20 — ¿el usuario puede editar el catálogo? (admin o módulo inventario). */
  puedeEditar = this.ctx.puedeOperarSubmodulo.bind(this.ctx);

  /** AS20 — abre la edición del artículo. */
  editar(): void {
    const a = this.articulo();
    if (a) void this.router.navigate(['/inventario/articulo', a.id, 'editar']);
  }

  /** AP3 — kardex del artículo en un almacén concreto. */
  verKardex(bodegaId: string): void {
    const a = this.articulo();
    if (!a || !bodegaId) return;
    void this.router.navigate(['/inventario/kardex', bodegaId, a.id]);
  }

  loading = signal(true);
  articulo = signal<ArticuloCat | null>(null);
  categorias = signal<CategoriaInv[]>([]);
  bodega = signal<Bodega | null>(null);
  stock = signal<{ cantidad: number; unidad: string } | null>(null);
  lightbox = signal(false);
  /** AS20 — stock por almacén (todos), para el catálogo global. */
  stockPorAlmacen = signal<{ bodegaId: string; nombre: string; cantidad: number; unidad: string; destacado: boolean }[]>([]);
  cargandoStock = signal(false);

  categoriaNombre = computed(() => {
    const a = this.articulo();
    if (!a?.categoria_id) return 'Sin categoría';
    return this.categorias().find((c) => c.id === a.categoria_id)?.nombre ?? 'Sin categoría';
  });
  esExterno = computed(() => esArticuloExterno(this.articulo()?.propiedad));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    const bodegaId = this.route.snapshot.queryParamMap.get('bodega') ?? '';
    this.loading.set(true);
    try {
      const [a, cats, bodegas] = await Promise.all([
        this.inventario.getArticulo(id),
        this.inventario.getCategorias().catch(() => []),
        this.inventario.getBodegas().catch(() => []),
      ]);
      this.articulo.set(a);
      this.categorias.set(cats);
      if (bodegaId) {
        this.bodega.set(bodegas.find((b) => b.id === bodegaId) ?? null);
        const s = await this.inventario.stockArticuloBodega(id, bodegaId);
        this.stock.set(s);
      }
      // AS20 — stock por almacén (todos). En paralelo; tolerante a offline (los
      // que no respondan quedan fuera). Con mayor cantidad primero.
      if (a && bodegas.length) void this.cargarStockPorAlmacen(id, bodegas, bodegaId, a.unidad);
    } finally {
      this.loading.set(false);
    }
  }

  /** AS20 — consulta el stock del artículo en cada almacén (paralelo, best-effort). */
  private async cargarStockPorAlmacen(
    articuloId: string,
    bodegas: Bodega[],
    bodegaCtx: string,
    unidadArt: string | null,
  ): Promise<void> {
    this.cargandoStock.set(true);
    try {
      const filas = await Promise.all(
        bodegas.map(async (b) => {
          const s = await this.inventario.stockArticuloBodega(articuloId, b.id);
          return s
            ? { bodegaId: b.id, nombre: b.nombre, cantidad: s.cantidad, unidad: s.unidad || unidadArt || '', destacado: b.id === bodegaCtx }
            : null;
        }),
      );
      const list = filas.filter((f): f is NonNullable<typeof f> => f !== null);
      list.sort((a, b) => Number(b.destacado) - Number(a.destacado) || b.cantidad - a.cantidad);
      this.stockPorAlmacen.set(list);
    } finally {
      this.cargandoStock.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
