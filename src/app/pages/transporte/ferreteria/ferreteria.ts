import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Location } from '@angular/common';
import { Router } from '@angular/router';

import { SelectList } from '../../../shared/ui/select-list/select-list';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';

/**
 * AD6 — Compra/retiro en ferretería (chofer, dentro de Transporte). Registra el
 * recibo como una entrada PENDIENTE que Almacén confirma antes de subir stock
 * (antifraude). Foto del recibo solo-cámara. Materiales opcionales (Almacén
 * ajusta al confirmar). Offline-first por outbox.
 */
@Component({
  selector: 'app-ferreteria',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectList, PhotoSlot, WizardFooter, ArticuloPicker, ConfirmDialog, BigConfirm],
  templateUrl: './ferreteria.html',
  styleUrl: './ferreteria.scss',
})
export class FerreteriaPage implements OnDestroy {
  private inventario = inject(InventarioService);
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
  referencia = signal('');
  proveedor = signal('');
  observaciones = signal('');
  foto = signal<CapturedPhoto | null>(null);

  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  verMateriales = signal(false);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  faltaFoto = computed(() => !this.foto());
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id).filter((x): x is string => !!x));

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

  // ---- Materiales (opcional) ----
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

  onFoto(photo: CapturedPhoto): void {
    this.foto.set(photo);
  }
  onFotoCleared(): void {
    this.foto.set(null);
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén destino.');
      return;
    }
    if (this.faltaFoto()) {
      this.toast.error('Toma la foto del recibo antes de registrar.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.inventario.enqueueCompraFerreteria({
        bodegaId: this.bodegaId(),
        proyectoId: this.obraId() || null,
        referencia: this.referencia().trim() || null,
        proveedor: this.proveedor().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: this.cart()
          .filter((l) => l.cantidad > 0 && l.articulo_id)
          .map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
        foto: this.foto()?.blob ?? null,
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la compra.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return !!(
      this.bodegaId() ||
      this.obraId() ||
      this.referencia().trim() ||
      this.proveedor().trim() ||
      this.observaciones().trim() ||
      this.foto() ||
      this.cart().length
    );
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
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
