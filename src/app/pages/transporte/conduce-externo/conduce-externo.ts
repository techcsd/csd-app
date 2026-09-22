import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { Router } from '@angular/router';

import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { LugarPicker, LugarSel } from '../../../shared/ui/lugar-picker/lugar-picker';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { QtyInput } from '../../../shared/ui/qty-input/qty-input';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { SyncBar } from '../../../shared/components/sync-bar/sync-bar';
import { ConducesService, ProveedorTransporte, ConduceExternoLugar } from '../../../core/services/conduces.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv } from '../../../core/models/inventario.model';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';
import { humanizeError } from '../../../shared/util/friendly-error.util';

/** Proveedor elegido: del catálogo (id) o texto libre «Otro» (sin registrar aún). */
interface ProveedorElegido {
  id: string | null;
  texto: string | null;
  nombre: string;
}

/** BT4 — forma persistida del borrador (las fotos van aparte en `borrador_fotos`). */
interface ConduceExternoBorrador {
  prov: ProveedorElegido | null;
  materialDesc: string;
  origen: LugarSel | null;
  destino: LugarSel | null;
  // BV6 — renglones del inventario (cuando "Con materiales del inventario").
  conMateriales?: boolean;
  origenBodegaId?: string;
  cart?: CartLinea[];
}

/**
 * BA/Transporte v3 (FASE 1) — Conduce externo: un PROVEEDOR transporta (manda su
 * camión). Formulario corto de obra: quién transporta, foto(s) de placa + carga
 * (obligatoria la placa), qué mueve, origen→destino («Otros» incluido). Offline-safe
 * vía outbox; el viaje al proveedor lo registra el servidor al emitir.
 *
 * BT4 — autoguarda un BORRADOR (formulario + fotos ya tomadas) en cada cambio y al
 * ocultar/descargar la pestaña. Si la app se cierra (Safari mata la pestaña por
 * memoria, Android recrea la Activity al volver de la cámara) NADA se pierde: al
 * reabrir aparece el aviso "Tienes un borrador sin enviar — Continuar / Descartar".
 */
@Component({
  selector: 'app-conduce-externo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, PhotoSlot, LugarPicker, CollapsibleSelect, ArticuloPicker, QtyInput, SyncBar, TranslatePipe],
  templateUrl: './conduce-externo.html',
  styleUrl: './conduce-externo.scss',
})
export class ConduceExternoPage {
  private conduces = inject(ConducesService);
  private inventario = inject(InventarioService);
  private net = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private location = inject(Location);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);

  /** Una sola captura activa a la vez → clave fija. */
  private readonly clave = 'conduce_externo';

  // Proveedores
  proveedores = signal<ProveedorTransporte[]>([]);
  busquedaProv = signal('');
  proveedorSel = signal<ProveedorElegido | null>(null);
  modoOtroProv = signal(false);
  nombreOtro = signal('');
  telOtro = signal('');
  creandoProv = signal(false);

  // Fotos
  placaFoto = signal<CapturedPhoto | null>(null);
  cargaFoto = signal<CapturedPhoto | null>(null);

  // Material (descripción libre para lo que NO es inventario)
  materialDesc = signal('');

  // BV6 — "Con materiales del inventario": el conduce mueve stock de verdad. Origen =
  // una bodega/obra NUESTRA (baja stock al emitir); destino nuestro (entrada pendiente)
  // o externo (solo salida). Los renglones usan el stock del CatalogService.
  conMateriales = signal(false);
  bodegas = signal<Bodega[]>([]);
  origenBodegaId = signal('');
  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  private existencias = signal<Record<string, number>>({});
  buscarArticulosFuzzy = (q: string): Promise<ArticuloCat[]> => this.inventario.buscarArticulos(q, 12);

  // Origen / destino (modo libre: lugares con o sin coords)
  origen = signal<LugarSel | null>(null);
  destino = signal<LugarSel | null>(null);

  guardando = signal(false);
  error = signal('');
  exito = signal<string | null>(null);

  // BS1 — bodegas ordenadas con la Central primero (🏢) + preseleccionada.
  private rankCentral(b: Bodega): number {
    return b.es_central ? 0 : b.es_principal ? 1 : 2;
  }
  bodegaOptions = computed<SelectOption[]>(() =>
    [...this.bodegas()]
      .sort((a, b) => this.rankCentral(a) - this.rankCentral(b))
      .map((b) => ({ id: b.id, label: (b.es_central || b.es_principal ? '🏢 ' : '') + b.nombre })),
  );
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id!).filter(Boolean));
  /** Stock del almacén de origen para el picker (null = sin dato cargado → no verifica). */
  stockParaPicker = computed<Record<string, number> | null>(() =>
    Object.keys(this.existencias()).length > 0 ? this.existencias() : null,
  );

  // BT4 — recuperación de borrador.
  borradorPrevio = signal(false);
  private hydrated = false;

  get online(): boolean {
    return this.net.online();
  }

  proveedoresFiltrados = computed(() => {
    const q = this.busquedaProv().trim().toLowerCase();
    const base = this.proveedores();
    if (!q) return base.slice(0, 12);
    return base.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 12);
  });

  puedeEmitir = computed(() => {
    if (this.guardando() || !this.proveedorSel() || !this.placaFoto()) return false;
    // BV6 — con materiales del inventario: origen obligatorio + al menos un renglón.
    if (this.conMateriales()) return !!this.origenBodegaId() && this.cart().some((l) => l.cantidad > 0);
    return true;
  });

  constructor() {
    void this.cargarProveedores();
    void this.cargarInventario();
    void this.restoreDraft();
    // BT4 — autoguardado del formulario (las fotos se guardan al capturarlas).
    effect(() => {
      const snap: ConduceExternoBorrador = {
        prov: this.proveedorSel(),
        materialDesc: this.materialDesc(),
        origen: this.origen(),
        destino: this.destino(),
        conMateriales: this.conMateriales(),
        origenBodegaId: this.origenBodegaId(),
        cart: this.cart(),
      };
      if (!this.hydrated || this.guardando() || this.exito()) return;
      // Solo guarda si hay algo que valga la pena recuperar.
      if (!this.tieneDatos()) return;
      this.autosave.queue(this.clave, snap, {
        tipo: 'conduce_externo',
        etiqueta: 'Conduce externo',
        ruta: this.location.path(),
      });
    });
  }

  private async cargarProveedores(): Promise<void> {
    try {
      this.proveedores.set(await this.conduces.proveedoresTransporte());
    } catch {
      /* offline: el catálogo cae vacío; el usuario usa «Otro» */
    }
  }

  /** BV6 — bodegas + catálogo de artículos/categorías (read-through, offline). */
  private async cargarInventario(): Promise<void> {
    try {
      const [bod, arts, cats] = await Promise.all([
        this.inventario.getBodegas().catch(() => [] as Bodega[]),
        this.inventario.getArticulos().catch(() => [] as ArticuloCat[]),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
      ]);
      this.bodegas.set(bod);
      this.articulos.set(arts);
      this.categorias.set(cats);
    } catch {
      /* offline: sin catálogo el toggle sigue disponible pero sin sugerencias */
    }
  }

  /** BV6 — activa/desactiva el modo "con materiales del inventario". */
  toggleMateriales(on: boolean): void {
    this.conMateriales.set(on);
    if (!on) {
      this.origenBodegaId.set('');
      this.cart.set([]);
      this.existencias.set({});
    }
  }

  /** BV6 — elige el almacén de origen (nuestro) → carga sus existencias para el picker. */
  onOrigenBodega(id: string): void {
    this.origenBodegaId.set(id);
    this.cart.set([]);
    this.existencias.set({});
    if (id) void this.loadExistencias(id);
  }

  private async loadExistencias(bodegaId: string): Promise<void> {
    try {
      const ex = await this.inventario.getExistencias(bodegaId);
      const map: Record<string, number> = {};
      for (const e of ex) map[e.articulo_id] = e.cantidad;
      this.existencias.set(map);
    } catch {
      /* offline: sin existencias cargadas → el picker no verifica stock */
    }
  }

  // ── BV6 — renglones del inventario (mismo patrón que generar-conduce) ─────────
  stockDe(articuloId: string | null): number | null {
    if (!articuloId) return null;
    const m = this.existencias();
    if (articuloId in m) return m[articuloId];
    return Object.keys(m).length > 0 ? 0 : null;
  }
  private topeStock(articuloId: string): number {
    const s = this.stockDe(articuloId);
    return s == null ? Infinity : s;
  }
  agregar(a: ArticuloCat): void {
    const s = this.stockDe(a.id);
    if (s != null && s <= 0) {
      this.toast.error(`No hay existencia de "${a.nombre}" en el almacén de origen.`);
      return;
    }
    this.cart.update((list) => {
      if (list.some((l) => l.articulo_id === a.id)) return list;
      const cant = Math.min(1, this.topeStock(a.id));
      return [
        { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, categoria_id: a.categoria_id ?? null, cantidad: cant },
        ...list,
      ];
    });
  }
  setCantidad(articuloId: string, v: number): void {
    const cant = Math.min(this.topeStock(articuloId), Math.max(0, v || 0));
    this.cart.update((list) => list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l)));
  }
  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }
  topeDe(articuloId: string): number {
    return this.topeStock(articuloId);
  }

  /** BT4 — recupera el borrador (formulario + fotos) tras un cierre/kill. */
  private async restoreDraft(): Promise<void> {
    try {
      const d = await this.borrador.load<ConduceExternoBorrador>(this.clave);
      if (d) {
        this.proveedorSel.set(d.prov ?? null);
        this.materialDesc.set(d.materialDesc ?? '');
        this.origen.set(d.origen ?? null);
        this.destino.set(d.destino ?? null);
        // BV6 — renglones del inventario.
        this.conMateriales.set(d.conMateriales === true);
        this.origenBodegaId.set(d.origenBodegaId ?? '');
        this.cart.set(d.cart ?? []);
        if (this.origenBodegaId()) void this.loadExistencias(this.origenBodegaId());
      }
      // BT4 — las fotos se cargan SIEMPRE (aunque no haya fila de datos): el usuario
      // pudo tomar solo una foto y cerrar la app antes de tocar el formulario.
      const fotos = await this.borrador.loadFotos(this.clave);
      for (const f of fotos) {
        const foto: CapturedPhoto = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        if (f.slot === 'placa') this.placaFoto.set(foto);
        else if (f.slot === 'carga') this.cargaFoto.set(foto);
      }
      if (this.tieneDatos()) this.borradorPrevio.set(true);
    } catch {
      /* recuperar el borrador nunca debe impedir abrir la pantalla */
    } finally {
      this.hydrated = true;
    }
  }

  /** BT4 — asegura que exista fila de borrador (aunque el formulario esté vacío) al
   *  tomar una foto, para que "Documentación en proceso" lo liste y se recupere. */
  private tocarBorrador(): void {
    this.autosave.queue(
      this.clave,
      {
        prov: this.proveedorSel(),
        materialDesc: this.materialDesc(),
        origen: this.origen(),
        destino: this.destino(),
        conMateriales: this.conMateriales(),
        origenBodegaId: this.origenBodegaId(),
        cart: this.cart(),
      },
      { tipo: 'conduce_externo', etiqueta: 'Conduce externo', ruta: this.location.path() },
    );
  }

  private tieneDatos(): boolean {
    return (
      !!this.proveedorSel() ||
      !!this.placaFoto() ||
      !!this.cargaFoto() ||
      !!this.materialDesc().trim() ||
      !!this.origen() ||
      !!this.destino() ||
      this.cart().length > 0 ||
      !!this.origenBodegaId()
    );
  }

  elegirProveedor(p: ProveedorTransporte): void {
    this.proveedorSel.set({ id: p.id, texto: null, nombre: p.nombre });
    this.modoOtroProv.set(false);
  }

  quitarProveedor(): void {
    this.proveedorSel.set(null);
  }

  abrirOtroProv(): void {
    this.modoOtroProv.set(true);
    if (this.busquedaProv().trim() && !this.nombreOtro().trim()) this.nombreOtro.set(this.busquedaProv().trim());
  }

  /** «Otro» sin registrar: viaja como texto (Raykler lo formaliza/absorbe luego). */
  usarOtroTexto(): void {
    const nombre = this.nombreOtro().trim();
    if (!nombre) return;
    this.proveedorSel.set({ id: null, texto: nombre, nombre });
    this.modoOtroProv.set(false);
  }

  /** Alta al vuelo (online): crea el proveedor formal (sin ratificar) y lo elige. */
  async crearProveedor(): Promise<void> {
    const nombre = this.nombreOtro().trim();
    if (!nombre) return;
    if (!this.online) {
      this.toast.error('Sin conexión: se usará el nombre como texto. Raykler lo registrará luego.');
      this.usarOtroTexto();
      return;
    }
    this.creandoProv.set(true);
    try {
      const id = await this.conduces.crearProveedorTransporte(nombre, this.telOtro());
      this.proveedorSel.set({ id, texto: null, nombre });
      this.modoOtroProv.set(false);
      this.nombreOtro.set('');
      this.telOtro.set('');
      void this.cargarProveedores();
    } catch {
      // Falla el alta → no trancar: usa el texto y sigue.
      this.toast.error('No se pudo registrar el proveedor; se usará como texto.');
      this.usarOtroTexto();
    } finally {
      this.creandoProv.set(false);
    }
  }

  // ── Fotos (BT4/BT5: persisten al instante; se libera la URL anterior) ────────

  onPlaca(foto: CapturedPhoto): void {
    this.revoke(this.placaFoto());
    this.placaFoto.set(foto);
    void this.borrador.saveFoto(this.clave, 'placa', foto.blob);
    this.tocarBorrador();
  }
  quitarPlaca(): void {
    this.revoke(this.placaFoto());
    this.placaFoto.set(null);
    void this.borrador.removeFoto(this.clave, 'placa');
  }
  onCarga(foto: CapturedPhoto): void {
    this.revoke(this.cargaFoto());
    this.cargaFoto.set(foto);
    void this.borrador.saveFoto(this.clave, 'carga', foto.blob);
    this.tocarBorrador();
  }
  quitarCarga(): void {
    this.revoke(this.cargaFoto());
    this.cargaFoto.set(null);
    void this.borrador.removeFoto(this.clave, 'carga');
  }

  onOrigen(l: LugarSel | null): void {
    this.origen.set(l);
  }
  onDestino(l: LugarSel | null): void {
    this.destino.set(l);
  }

  // ── Borrador: banner ─────────────────────────────────────────────────────────

  continuarBorrador(): void {
    this.borradorPrevio.set(false);
  }

  descartarBorrador(): void {
    // Confirmación simple (evita borrar por accidente lo capturado).
    this.toast.withAction('¿Descartar el borrador sin enviar?', {
      label: 'Descartar',
      run: () => {
        this.revoke(this.placaFoto());
        this.revoke(this.cargaFoto());
        void this.autosave.discard(this.clave);
        this.resetCampos();
        this.borradorPrevio.set(false);
        this.toast.show('Borrador descartado.', 'info');
      },
    });
  }

  private aLugar(l: LugarSel | null): ConduceExternoLugar | null {
    if (!l) return null;
    return {
      nombre: l.nombre,
      lat: l.lat ?? null,
      lng: l.lng ?? null,
      proyecto_id: l.proyecto_id ?? null,
      bodega_id: l.bodega_id ?? null,
    };
  }

  /**
   * BT7 — ¿el proveedor del catálogo sigue vigente? Se pudo borrar/fusionar desde
   * que se cacheó (esa era la causa del error crudo de FK en el conduce). Refresca
   * el catálogo (read-through) y comprueba el id. Offline / sin poder verificar →
   * devuelve true (no bloquea; el servidor valida y, si no, se muestra "Revisar
   * dato" en Pendientes con el mensaje amable del servidor).
   */
  private async proveedorVigente(id: string): Promise<boolean> {
    try {
      const lista = await this.conduces.proveedoresTransporte();
      if (!lista.length) return true; // sin catálogo (offline): no bloquear
      return lista.some((p) => p.id === id);
    } catch {
      return true;
    }
  }

  async emitir(): Promise<void> {
    const prov = this.proveedorSel();
    const placa = this.placaFoto();
    if (!prov || !placa) {
      this.error.set('Indica quién transporta y toma la foto de la placa.');
      return;
    }
    this.guardando.set(true);
    this.error.set('');
    try {
      let provId = prov.id;
      let provTexto = prov.texto;
      // BT7 — si eligió un proveedor del catálogo pero ya no existe, lo enviamos como
      // TEXTO (su nombre) para que el conduce NO muera por un id colgado. Se avisa.
      if (provId && !(await this.proveedorVigente(provId))) {
        provId = null;
        provTexto = prov.nombre;
        this.toast.show('Ese proveedor ya no está en la lista; se envía por su nombre.', 'info', 4000);
      }
      // BV6 — con materiales del inventario: renglones del catálogo + origen = bodega
      // nuestra (el servidor baja stock al emitir / crea entrada pendiente en destino).
      const conMat = this.conMateriales();
      const items = conMat
        ? this.cart()
            .filter((l) => l.cantidad > 0)
            .map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad }))
        : null;
      const bodega = this.bodegas().find((b) => b.id === this.origenBodegaId());
      const origenInv: ConduceExternoLugar | null =
        conMat && bodega
          ? { nombre: bodega.nombre, lat: null, lng: null, proyecto_id: bodega.proyecto_id ?? null, bodega_id: bodega.id }
          : null;
      await this.conduces.crearConduceExterno({
        transportaProveedorId: provId,
        transportaTexto: provTexto,
        placaFoto: placa.blob,
        cargaFoto: this.cargaFoto()?.blob ?? null,
        materialDescripcion: this.materialDesc().trim() || null,
        items,
        origen: conMat ? origenInv : this.aLugar(this.origen()),
        destino: this.aLugar(this.destino()),
      });
      await this.autosave.discard(this.clave); // limpia formulario + fotos del borrador
      this.borradorPrevio.set(false);
      this.exito.set(prov.nombre);
    } catch (e) {
      this.error.set(e instanceof Error ? humanizeError(e).mensaje : 'No se pudo emitir el conduce externo.');
    } finally {
      this.guardando.set(false);
    }
  }

  private resetCampos(): void {
    this.proveedorSel.set(null);
    this.busquedaProv.set('');
    this.nombreOtro.set('');
    this.telOtro.set('');
    this.placaFoto.set(null);
    this.cargaFoto.set(null);
    this.materialDesc.set('');
    this.origen.set(null);
    this.destino.set(null);
    this.conMateriales.set(false);
    this.origenBodegaId.set('');
    this.cart.set([]);
    this.existencias.set({});
    this.error.set('');
  }

  nuevo(): void {
    // Éxito → limpiar todo (el borrador ya se descartó al emitir).
    this.revoke(this.placaFoto());
    this.revoke(this.cargaFoto());
    this.resetCampos();
    this.exito.set(null);
  }

  private revoke(f: CapturedPhoto | null): void {
    if (f?.previewUrl) {
      try {
        URL.revokeObjectURL(f.previewUrl);
      } catch {
        /* ignore */
      }
    }
  }

  back(): void {
    // El borrador sigue guardado (autosave); asegura el flush antes de salir.
    void this.autosave.flushAll();
    this.location.back();
  }

  irAlHub(): void {
    void this.router.navigate(['/transporte/conduces-hub']);
  }
}
