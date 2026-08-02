import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';

import { SelectList } from '../../../shared/ui/select-list/select-list';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { ConducesService } from '../../../core/services/conduces.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';

/**
 * AE — Generar conduce (salida de material) desde el móvil: el chofer SACA
 * material de una bodega hacia una obra. El servidor valida el stock
 * (crear_conduce_transportista). Buscador de artículos (sin categorías) + cantidad.
 * Offline-first por outbox; luego aparece en "Conduces por entregar" para
 * entregarlo con las 2 firmas (AC7).
 */
@Component({
  selector: 'app-generar-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectList, WizardFooter, ArticuloPicker, ConfirmDialog, BigConfirm],
  templateUrl: './generar-conduce.html',
  styleUrl: './generar-conduce.scss',
})
export class GenerarConducePage implements OnDestroy {
  private inventario = inject(InventarioService);
  private conduces = inject(ConducesService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  hoja = signal<'form' | 'exito'>('form');
  loading = signal(true);
  submitting = signal(false);
  confirmSalir = signal(false);

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  obras = signal<ObraOrigen[]>([]);
  obraId = signal('');
  observaciones = signal('');

  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  // AE — stock disponible en la bodega de origen (articulo_id → cantidad), para
  // avisar si el chofer intenta sacar más de lo que hay.
  private existencias = signal<Record<string, number>>({});

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id).filter((x): x is string => !!x));
  faltaItems = computed(() => this.cart().filter((l) => l.cantidad > 0).length === 0);
  hayExceso = computed(() => this.cart().some((l) => this.excedeStock(l)));

  private readonly backHandler = (): boolean => {
    if (this.hoja() === 'form' && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    void this.init();
    this.navGuard.register(this.backHandler);
    // AE — al elegir/cambiar la bodega de origen, carga su stock para el preview.
    effect(() => {
      const b = this.bodegaId();
      if (b) void this.loadExistencias(b);
    });
  }

  private async loadExistencias(bodegaId: string): Promise<void> {
    try {
      const ex = await this.inventario.getExistencias(bodegaId);
      const map: Record<string, number> = {};
      for (const e of ex) map[e.articulo_id] = e.cantidad;
      this.existencias.set(map);
    } catch {
      /* offline / sin datos: el preview de stock queda vacío */
    }
  }

  /** AE — stock disponible del material en la bodega elegida (null si no se sabe). */
  stockDe(articuloId: string | null): number | null {
    if (!articuloId) return null;
    const m = this.existencias();
    return articuloId in m ? m[articuloId] : null;
  }
  /** AE — la cantidad a sacar supera el stock conocido. */
  excedeStock(l: CartLinea): boolean {
    const s = this.stockDe(l.articulo_id);
    return s != null && l.cantidad > s;
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const [b, obras, a, cat] = await Promise.all([
        this.inventario.getBodegas(),
        this.inventario.getObrasConBodega().catch(() => [] as ObraOrigen[]),
        this.inventario.getArticulos().catch(() => [] as ArticuloCat[]),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
      ]);
      this.bodegas.set(b);
      this.obras.set(obras);
      this.articulos.set(a);
      this.categorias.set(cat);
      if (b.length === 1) this.bodegaId.set(b[0].id);
    } finally {
      this.loading.set(false);
    }
  }

  // ---- Materiales ----
  agregar(a: ArticuloCat): void {
    this.cart.update((list) => {
      if (list.some((l) => l.articulo_id === a.id)) return list;
      return [
        ...list,
        { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, categoria_id: a.categoria_id ?? null, cantidad: 1 },
      ];
    });
  }
  ajustar(articuloId: string, delta: number): void {
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.max(0, l.cantidad + delta) } : l))
        .filter((l) => l.cantidad > 0),
    );
  }
  setCantidad(articuloId: string, v: number): void {
    const cant = Math.max(0, v || 0);
    this.cart.update((list) =>
      list
        .map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l))
        .filter((l) => l.cantidad > 0),
    );
  }
  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén de origen.');
      return;
    }
    if (!this.obraId()) {
      this.toast.error('Elige la obra destino.');
      return;
    }
    if (this.faltaItems()) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.conduces.crearConduceTransportista({
        bodegaId: this.bodegaId(),
        proyectoId: this.obraId(),
        observaciones: this.observaciones().trim() || null,
        items: this.cart()
          .filter((l) => l.cantidad > 0 && l.articulo_id)
          .map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el conduce.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return !!(this.bodegaId() || this.obraId() || this.observaciones().trim() || this.cart().length);
  }

  intentarSalir(): void {
    if (this.tieneDatos()) this.confirmSalir.set(true);
    else this.finish();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.finish();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }

  finish(): void {
    void this.router.navigate(['/transporte/conduces'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
