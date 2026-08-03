import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';

import { SelectList } from '../../../shared/ui/select-list/select-list';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import {
  InventarioService,
  ObraOrigen,
  DevolucionChoferCaptura,
  UsuarioBusqueda,
} from '../../../core/services/inventario.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';

/**
 * AE — Devolver material (obra → almacén). El chofer registra y el stock se mueve
 * directo; el antifraude son las 2 FIRMAS: emisor (chofer) + receptor (él mismo o
 * el ingeniero/encargado). Si el receptor no está, su firma queda PENDIENTE y se le
 * enruta (aviso + bandeja "Por firmar"). Offline-first por outbox.
 */
@Component({
  selector: 'app-devolver-material',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, SelectList, WizardFooter, ArticuloPicker, ConfirmDialog, BigConfirm, SignaturePad, OptionButton],
  templateUrl: './devolver-material.html',
  styleUrl: './devolver-material.scss',
})
export class DevolverMaterialPage implements OnDestroy {
  private inventario = inject(InventarioService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  private emisorPad = viewChild<SignaturePad>('emisorPad');
  private receptorPad = viewChild<SignaturePad>('receptorPad');

  hoja = signal<'form' | 'exito'>('form');
  loading = signal(true);
  submitting = signal(false);
  confirmSalir = signal(false);
  pendiente = signal(false); // resultado: quedó firma pendiente

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal(''); // almacén destino
  obras = signal<ObraOrigen[]>([]);
  obraId = signal(''); // obra origen
  referencia = signal('');
  observaciones = signal('');

  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  // AE — stock disponible en el almacén de la obra origen (articulo_id → cantidad).
  private existencias = signal<Record<string, number>>({});
  hayExceso = computed(() => this.cart().some((l) => this.excedeStock(l)));

  // Receptor: yo mismo (el chofer) o un ingeniero/encargado.
  receptorModo = signal<'yo' | 'otro'>('yo');
  receptorPresente = signal(true); // solo aplica a 'otro'
  receptorBusqueda = signal('');
  receptorResultados = signal<UsuarioBusqueda[]>([]);
  receptorSel = signal<UsuarioBusqueda | null>(null);
  buscando = signal(false);

  emisorNombre = computed(() => this.ctx.nombre() || 'Chofer');
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id).filter((x): x is string => !!x));
  faltaItems = computed(() => this.cart().filter((l) => l.cantidad > 0).length === 0);

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
    // AE — al elegir/cambiar la obra origen, carga su stock para el preview.
    effect(() => {
      const o = this.obraId();
      if (o) void this.loadExistencias(o);
      else this.existencias.set({});
    });
  }
  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async loadExistencias(proyectoId: string): Promise<void> {
    try {
      this.existencias.set(await this.inventario.existenciasDeObra(proyectoId));
    } catch {
      this.existencias.set({});
    }
  }
  /** AE — stock disponible del material en la obra (null si no se sabe). */
  stockDe(articuloId: string | null): number | null {
    if (!articuloId) return null;
    const m = this.existencias();
    return articuloId in m ? m[articuloId] : null;
  }
  /** AE — la cantidad a devolver supera el stock de la obra. */
  excedeStock(l: CartLinea): boolean {
    const s = this.stockDe(l.articulo_id);
    return s != null && l.cantidad > s;
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
      // Solo obras con almacén propio (se descuenta de ahí).
      this.obras.set(obras.filter((o) => o.tieneBodega));
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
      return [...list, { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, categoria_id: a.categoria_id ?? null, cantidad: 1 }];
    });
  }
  ajustar(articuloId: string, delta: number): void {
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.max(0, l.cantidad + delta) } : l)).filter((l) => l.cantidad > 0),
    );
  }
  setCantidad(articuloId: string, v: number): void {
    const cant = Math.max(0, v || 0);
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l)).filter((l) => l.cantidad > 0),
    );
  }
  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  // ---- Receptor ----
  setReceptorModo(m: 'yo' | 'otro'): void {
    this.receptorModo.set(m);
    if (m === 'yo') {
      this.receptorSel.set(null);
      this.receptorResultados.set([]);
    }
  }
  async buscarReceptor(): Promise<void> {
    const term = this.receptorBusqueda().trim();
    if (term.length < 2) {
      this.receptorResultados.set([]);
      return;
    }
    this.buscando.set(true);
    try {
      this.receptorResultados.set(await this.inventario.buscarUsuarios(term));
    } catch {
      /* best-effort */
    } finally {
      this.buscando.set(false);
    }
  }
  pickReceptor(u: UsuarioBusqueda): void {
    this.receptorSel.set(u);
    this.receptorResultados.set([]);
    this.receptorBusqueda.set(u.nombre);
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.obraId()) return this.toast.error('Elige la obra de origen.');
    if (!this.bodegaId()) return this.toast.error('Elige el almacén destino.');
    if (this.faltaItems()) return this.toast.error('Agrega al menos un material.');

    const emisorBlob = await this.emisorPad()?.toBlob();
    if (!emisorBlob) return this.toast.error('Falta tu firma (quien entrega).');

    let receptorNombre: string | null;
    let receptorUsuarioId: string | null;
    let firmaReceptor: Blob | null;

    if (this.receptorModo() === 'yo') {
      receptorNombre = this.emisorNombre();
      receptorUsuarioId = this.ctx.profile()?.id ?? null;
      firmaReceptor = emisorBlob; // el chofer recibe él mismo → misma firma
    } else {
      const u = this.receptorSel();
      if (!u) return this.toast.error('Elige quién recibe.');
      receptorNombre = u.nombre;
      receptorUsuarioId = u.id;
      if (this.receptorPresente()) {
        firmaReceptor = (await this.receptorPad()?.toBlob()) ?? null;
        if (!firmaReceptor) return this.toast.error('Falta la firma de quien recibe.');
      } else {
        firmaReceptor = null; // queda pendiente y se le enruta
      }
    }

    this.submitting.set(true);
    try {
      const captura: DevolucionChoferCaptura = {
        bodegaDestinoId: this.bodegaId(),
        origenProyectoId: this.obraId(),
        referencia: this.referencia().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: this.cart().filter((l) => l.cantidad > 0 && l.articulo_id).map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
        emisorNombre: this.emisorNombre(),
        firmaEmisor: emisorBlob,
        receptorNombre,
        receptorUsuarioId,
        firmaReceptor,
      };
      await this.inventario.enqueueDevolucionChofer(captura);
      this.pendiente.set(this.receptorModo() === 'otro' && !this.receptorPresente());
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la devolución.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return !!(this.obraId() || this.bodegaId() || this.referencia().trim() || this.observaciones().trim() || this.cart().length);
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

  // Emisor/receptor firma listeners (para no romper el binding del pad).
  onEmisorFirma(): void {
    /* el blob se toma en submit vía toBlob() */
  }
  onReceptorFirma(): void {
    /* idem */
  }

  get online(): boolean {
    return this.network.online();
  }
}
