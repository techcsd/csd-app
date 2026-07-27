import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { InventarioService } from '../../../core/services/inventario.service';
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
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  readonly propiedadLabel = propiedadLabel;

  loading = signal(true);
  articulo = signal<ArticuloCat | null>(null);
  categorias = signal<CategoriaInv[]>([]);
  bodega = signal<Bodega | null>(null);
  stock = signal<{ cantidad: number; unidad: string } | null>(null);
  lightbox = signal(false);

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
    } finally {
      this.loading.set(false);
    }
  }

  back(): void {
    this.location.back();
  }
}
