import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { ConducesService } from '../../../core/services/conduces.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { TrackingService } from '../../../core/services/tracking.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { PermisoGateService } from '../../../core/services/permiso-gate.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv, Ferreteria } from '../../../core/models/inventario.model';
import { MiAsignacion } from '../../../core/models/transporte.model';

/** AF31 — de dónde sale el material del conduce. */
type OrigenTipo = 'almacen' | 'ferreteria' | 'otros';

/**
 * AE/AF31 — Crear conduce con selector de ORIGEN:
 *  - **Almacén** (salida de stock hacia una obra o de vuelta a un suplidor).
 *  - **Ferretería** (compra → ENTRADA en un almacén; reúsa el flujo de ferretería).
 *  - **Otros** (origen no registrado: nombre + ubicación actual; movimiento sin stock).
 * Almacén/Otros generan la ruta al emitir (con vehículo) y piden firma del emisor.
 * Offline-first por outbox.
 */
@Component({
  selector: 'app-generar-conduce',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, CollapsibleSelect, OptionButton, WizardFooter, ArticuloPicker, ConfirmDialog, BigConfirm, PhotoSlot, SignaturePad],
  templateUrl: './generar-conduce.html',
  styleUrl: './generar-conduce.scss',
})
export class GenerarConducePage implements OnDestroy {
  private inventario = inject(InventarioService);
  private conduces = inject(ConducesService);
  private vehiculos = inject(VehiculosService);
  private ctx = inject(UserContextService);
  private tracking = inject(TrackingService);
  private permissions = inject(PermissionsService);
  private gate = inject(PermisoGateService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);

  /** AG15 — id de la tarea que originó este conduce (se enlaza al emitir). */
  private tareaVinculada: string | null = null;

  private sig = viewChild(SignaturePad);

  hoja = signal<'form' | 'exito'>('form');
  loading = signal(true);
  submitting = signal(false);
  confirmSalir = signal(false);

  // AF31 — tipo de origen.
  origenTipo = signal<OrigenTipo>('almacen');

  bodegas = signal<Bodega[]>([]);
  bodegaId = signal(''); // almacén origen (almacen) / almacén destino (ferretería)
  obras = signal<ObraOrigen[]>([]);
  obraId = signal('');
  observaciones = signal('');

  // AF31 — destino: obra (normal) o suplidor (devolución de equipo alquilado, texto).
  destinoTipo = signal<'obra' | 'suplidor'>('obra');
  suplidorNombre = signal('');

  // AF31 — ferreterías (origen = compra/entrada).
  ferreterias = signal<Ferreteria[]>([]);
  ferreteriaId = signal('');
  referencia = signal('');
  fotoRecibo = signal<CapturedPhoto | null>(null);
  fotoMercancia = signal<CapturedPhoto | null>(null);

  // AF31 — "Otros": origen libre + coordenadas actuales.
  otrosNombre = signal('');
  private otrosCoords: { lat: number; lng: number } | null = null;
  otrosGpsOk = signal(false);

  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  private existencias = signal<Record<string, number>>({});

  // AF23.4 — vehículo (para que el servidor auto-genere la ruta al emitir).
  misVehiculos = signal<MiAsignacion[]>([]);
  vehiculoId = signal('');
  vehiculoOptions = computed(() =>
    this.misVehiculos().map((v) => ({ id: v.vehiculo_id, label: `${v.placa} · ${v.marca} ${v.modelo}` })),
  );
  // AF23.3 — firma de quien entrega (emisor) — almacén/otros.
  firmaEmisor = signal<Blob | null>(null);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  ferreteriaOptions = computed(() => this.ferreterias().map((f) => ({ id: f.id, label: f.nombre })));
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id).filter((x): x is string => !!x));
  faltaItems = computed(() => this.cart().filter((l) => l.cantidad > 0).length === 0);
  hayExceso = computed(() => this.cart().some((l) => this.excedeStock(l)));

  // ¿El origen es una ferretería? (compra/entrada, sin ruta/firma/vehículo)
  esFerreteria = computed(() => this.origenTipo() === 'ferreteria');
  esOtros = computed(() => this.origenTipo() === 'otros');

  /** ¿Están los campos mínimos para emitir según el tipo de origen? */
  puedeEmitir = computed(() => {
    if (this.esFerreteria()) return !!(this.ferreteriaId() && this.bodegaId() && this.fotoRecibo());
    const destinoOk = this.destinoTipo() === 'obra' ? !!this.obraId() : !!this.suplidorNombre().trim();
    if (this.esOtros()) return !!(this.otrosNombre().trim() && destinoOk && this.firmaEmisor());
    return !!(this.bodegaId() && destinoOk && !this.faltaItems() && this.firmaEmisor());
  });

  /** Etiqueta del botón según el modo (compra vs conduce). */
  primaryLabel = computed(() =>
    this.submitting() ? 'Guardando…' : this.esFerreteria() ? 'Registrar compra' : 'Generar conduce',
  );

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
    // Al elegir/cambiar el almacén de origen, carga su stock para el preview.
    effect(() => {
      const b = this.bodegaId();
      if (b && this.origenTipo() === 'almacen') void this.loadExistencias(b);
    });
  }

  private async loadExistencias(bodegaId: string): Promise<void> {
    try {
      const ex = await this.inventario.getExistencias(bodegaId);
      const map: Record<string, number> = {};
      for (const e of ex) map[e.articulo_id] = e.cantidad;
      this.existencias.set(map);
    } catch {
      /* offline */
    }
  }

  stockDe(articuloId: string | null): number | null {
    if (!articuloId) return null;
    const m = this.existencias();
    if (articuloId in m) return m[articuloId];
    return Object.keys(m).length > 0 ? 0 : null;
  }
  excedeStock(l: CartLinea): boolean {
    // El chequeo de stock solo aplica al origen ALMACÉN (salida). Ferretería/otros no.
    if (this.origenTipo() !== 'almacen') return false;
    const s = this.stockDe(l.articulo_id);
    return s != null && l.cantidad > s;
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const [b, obras, a, cat, asig, ferr] = await Promise.all([
        this.inventario.getBodegas(),
        this.inventario.getObrasConBodega().catch(() => [] as ObraOrigen[]),
        this.inventario.getArticulos().catch(() => [] as ArticuloCat[]),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
        this.vehiculos.getMisAsignaciones().catch(() => [] as MiAsignacion[]),
        this.inventario.getFerreterias().catch(() => [] as Ferreteria[]),
      ]);
      this.bodegas.set(b);
      this.obras.set(obras);
      this.articulos.set(a);
      this.categorias.set(cat);
      this.misVehiculos.set(asig);
      this.ferreterias.set(ferr);
      if (b.length === 1) this.bodegaId.set(b[0].id);
      if (asig.length === 1) this.vehiculoId.set(asig[0].vehiculo_id);
      this.prefillFromQuery(); // AG15 — pre-llenar si viene de una tarea vinculada
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * AG15 — pre-llena el conduce cuando se abre desde una tarea vinculada
   * (deep-link con queryParams). Ej.: "comprar en ferretería X y llevar a obra Y".
   * El id de la tarea (`tarea`) se enlaza al conduce al emitir para que la tarea
   * se complete sola cuando se confirme la entrega.
   */
  private prefillFromQuery(): void {
    const q = this.route.snapshot.queryParamMap;
    const origen = q.get('origen') as OrigenTipo | null;
    if (origen === 'almacen' || origen === 'ferreteria' || origen === 'otros') {
      this.setOrigen(origen);
    }
    const bodega = q.get('bodega');
    if (bodega && this.bodegas().some((b) => b.id === bodega)) this.bodegaId.set(bodega);
    const ferreteria = q.get('ferreteria');
    if (ferreteria && this.ferreterias().some((f) => f.id === ferreteria)) {
      this.ferreteriaId.set(ferreteria);
    }
    const obra = q.get('obra');
    if (obra && this.obras().some((o) => o.id === obra)) {
      this.destinoTipo.set('obra');
      this.obraId.set(obra);
    }
    this.tareaVinculada = q.get('tarea');
  }

  /** AF31 — cambiar el tipo de origen limpia lo que no aplica. */
  setOrigen(t: OrigenTipo): void {
    this.origenTipo.set(t);
    if (t !== 'almacen') this.destinoTipo.set('obra');
  }

  onFerreteria(id: string): void {
    this.ferreteriaId.set(id);
  }

  /** AF31 — "Otros": toma la ubicación actual como origen (con permiso/gate). */
  async tomarUbicacionOtros(): Promise<void> {
    if (!(await this.gate.asegurar('location'))) return;
    const r = await this.permissions.getPosition({ highAccuracy: true, timeout: 10000 });
    if (r.ok) {
      this.otrosCoords = { lat: r.lat, lng: r.lng };
      this.otrosGpsOk.set(true);
      this.toast.success('Ubicación de origen fijada.');
    } else {
      this.toast.error('No se pudo obtener tu ubicación. Reintenta en un lugar despejado.');
    }
  }

  // ---- Materiales ----
  agregar(a: ArticuloCat): void {
    this.cart.update((list) => {
      if (list.some((l) => l.articulo_id === a.id)) return list;
      return [
        { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, categoria_id: a.categoria_id ?? null, cantidad: 1 },
        ...list,
      ];
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

  async onFirmaEmisor(has: boolean): Promise<void> {
    this.firmaEmisor.set(has ? ((await this.sig()?.toBlob()) ?? null) : null);
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.origenTipo() === 'ferreteria') return void this.submitFerreteria();
    return void this.submitConduce();
  }

  /** AF31 — origen ferretería: compra → ENTRADA (reúsa el flujo de ferretería). */
  private async submitFerreteria(): Promise<void> {
    if (!this.ferreteriaId()) {
      this.toast.error('Elige la ferretería.');
      return;
    }
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén donde entra la compra.');
      return;
    }
    if (!this.fotoRecibo()) {
      this.toast.error('Toma la foto del recibo.');
      return;
    }
    if (!(await this.tracking.exigirGps('crear_conduce'))) return;
    this.submitting.set(true);
    try {
      const ferr = this.ferreterias().find((f) => f.id === this.ferreteriaId());
      await this.inventario.enqueueCompraFerreteria({
        bodegaId: this.bodegaId(),
        proyectoId: this.obraId() || null,
        proveedorId: this.ferreteriaId(),
        proveedor: ferr?.nombre ?? null,
        referencia: this.referencia().trim() || null,
        observaciones: this.observaciones().trim() || null,
        items: this.cart().filter((l) => l.cantidad > 0 && l.articulo_id).map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
        foto: this.fotoRecibo()?.blob ?? null,
        fotoMercancia: this.fotoMercancia()?.blob ?? null,
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la compra.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** Almacén (salida) u Otros (movimiento sin stock) → conduce (+ ruta al emitir). */
  private async submitConduce(): Promise<void> {
    const otros = this.esOtros();
    if (otros) {
      if (!this.otrosNombre().trim()) {
        this.toast.error('Escribe de dónde sale el material.');
        return;
      }
    } else if (!this.bodegaId()) {
      this.toast.error('Elige el almacén de origen.');
      return;
    }
    // Destino: obra o suplidor (devolución de alquiler).
    if (this.destinoTipo() === 'obra' && !this.obraId()) {
      this.toast.error('Elige la obra destino.');
      return;
    }
    if (this.destinoTipo() === 'suplidor' && !this.suplidorNombre().trim()) {
      this.toast.error('Escribe el suplidor al que devuelves.');
      return;
    }
    if (!otros && this.faltaItems()) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    if (!this.firmaEmisor()) {
      this.toast.error('Falta la firma de quien entrega.');
      return;
    }
    if (!(await this.tracking.exigirGps('crear_conduce'))) return;
    this.submitting.set(true);
    try {
      // Observaciones enriquecidas con origen "Otros" y/o destino suplidor.
      const partes: string[] = [];
      if (otros) {
        const coords = this.otrosCoords ? ` (${this.otrosCoords.lat.toFixed(5)}, ${this.otrosCoords.lng.toFixed(5)})` : '';
        partes.push(`Origen: ${this.otrosNombre().trim()}${coords}`);
      }
      if (this.destinoTipo() === 'suplidor') partes.push(`Devolución a suplidor: ${this.suplidorNombre().trim()}`);
      if (this.observaciones().trim()) partes.push(this.observaciones().trim());
      const obs = partes.join(' — ') || null;

      await this.conduces.crearConduceTransportista({
        bodegaId: otros ? null : this.bodegaId(), // "Otros": sin bodega de stock
        proyectoId: this.destinoTipo() === 'obra' ? this.obraId() : null,
        observaciones: obs,
        vehiculoId: this.vehiculoId() || null,
        firmaEmisor: this.firmaEmisor(),
        emisorNombre: this.ctx.nombre() || null,
        items: otros
          ? []
          : this.cart().filter((l) => l.cantidad > 0 && l.articulo_id).map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad })),
        tareaVinculada: this.tareaVinculada, // AG15 — enlaza la tarea a esta salida
      });
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el conduce.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return !!(
      this.bodegaId() || this.obraId() || this.ferreteriaId() || this.otrosNombre().trim() ||
      this.suplidorNombre().trim() || this.observaciones().trim() || this.cart().length ||
      this.fotoRecibo() || this.fotoMercancia() || this.firmaEmisor()
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
    void this.router.navigate(['/transporte/conduces'], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
