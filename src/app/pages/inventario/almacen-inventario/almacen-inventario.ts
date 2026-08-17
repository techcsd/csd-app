import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { LiveRefreshDirective } from '../../../shared/ui/live-refresh/live-refresh.directive';
import { InventarioService, InventarioAlmacenItem } from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Bodega } from '../../../core/models/inventario.model';

/**
 * AP2 — Inventario de un almacén: artículos con existencia + apertura, buscador, y
 * un botón de histórico (kardex AP3) al lado de cada artículo. Accesible desde el
 * listado de Almacenes. El acceso lo decide el server (`inventario_almacen`): si el
 * rol no puede ver ese almacén, mostramos "no tienes acceso" (no un vacío mudo).
 */
@Component({
  selector: 'app-almacen-inventario',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, DecimalPipe, CollapsibleSelect, LiveRefreshDirective],
  templateUrl: './almacen-inventario.html',
  styleUrl: './almacen-inventario.scss',
})
export class AlmacenInventarioPage {
  private inventario = inject(InventarioService);
  private location = inject(Location);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private ctx = inject(UserContextService);

  /** AS11 — quién puede contar/ajustar el stock de un almacén (permiso Operar). */
  puedeAjustar = computed(() => this.ctx.puedeOperarSubmodulo('inventario.conteos'));

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  bodegaNombre = computed(() => this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '');

  items = signal<InventarioAlmacenItem[]>([]);
  query = signal('');
  ocultarCero = signal(false);
  loading = signal(false);
  denegado = signal(false);

  visibles = computed(() => {
    const q = this.query().toLowerCase().trim();
    return this.items().filter((it) => {
      if (this.ocultarCero() && it.es_cero) return false;
      if (!q) return true;
      return it.nombre.toLowerCase().includes(q) || it.codigo.toLowerCase().includes(q);
    });
  });

  totalMostrado = computed(() => this.visibles().length);

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    const b = await this.inventario.getBodegas();
    this.bodegas.set(b);
    const paramId = this.route.snapshot.paramMap.get('bodegaId');
    if (paramId) {
      this.bodegaId.set(paramId);
      await this.load();
    } else if (b.length === 1) {
      this.bodegaId.set(b[0].id);
      await this.load();
    }
  }

  async onBodega(id: string): Promise<void> {
    this.bodegaId.set(id);
    await this.load();
  }

  async load(silent = false): Promise<void> {
    if (!this.bodegaId()) return;
    if (!silent) this.loading.set(true);
    this.denegado.set(false);
    try {
      this.items.set(await this.inventario.inventarioAlmacen(this.bodegaId(), true));
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (/acceso/i.test(msg)) this.denegado.set(true);
      this.items.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  /** Refresco vivo (foreground/pull): silencioso si es automático. */
  onRefresh = (silent = false): void => {
    void this.load(silent);
  };

  /** AP3 — abre el kardex (histórico de movimientos) del artículo en este almacén. */
  verKardex(it: InventarioAlmacenItem): void {
    void this.router.navigate(['/inventario/kardex', this.bodegaId(), it.articulo_id]);
  }

  /** Detalle del artículo (con el almacén elegido para el stock). */
  abrirArticulo(it: InventarioAlmacenItem): void {
    void this.router.navigate(['/inventario/articulo', it.articulo_id], {
      queryParams: { bodega: this.bodegaId() || null },
    });
  }

  /** AS11 — editar/ajustar el stock de este almacén: abre "Conteos y ajustes" con
   *  el almacén ya seleccionado (agregar artículos del catálogo se hace ahí). */
  contarAjustar(): void {
    void this.router.navigate(['/inventario/conteo'], {
      queryParams: { bodega: this.bodegaId() || null },
    });
  }

  back(): void {
    this.location.back();
  }
}
