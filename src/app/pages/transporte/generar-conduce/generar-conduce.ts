import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { ArticuloPicker } from '../../../shared/ui/articulo-picker/articulo-picker';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { SignaturePad } from '../../../shared/ui/signature-pad/signature-pad';
import { DraftBanner } from '../../../shared/ui/draft-banner/draft-banner';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { SyncService } from '../../../core/sync/sync.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService, ObraOrigen } from '../../../core/services/inventario.service';
import { ConducesService, Despachante, AlmacenDestino } from '../../../core/services/conduces.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { TrackingService } from '../../../core/services/tracking.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { ArticuloCat, Bodega, CartLinea, CategoriaInv, Ferreteria, ItemLibre } from '../../../core/models/inventario.model';
import { MiAsignacion, VehiculoDisponible } from '../../../core/models/transporte.model';

/** AF31 — de dónde sale el material del conduce. (AM6 — se retiró "Otros": era un
 *  camino muerto, incompatible con el descuento de stock del conduce.) */
type OrigenTipo = 'almacen' | 'ferreteria';

/** AJ6 — hojas del wizard de creación de conduce. */
type PasoKey = 'origen' | 'destino' | 'materiales' | 'ferr-fotos' | 'foto' | 'despacho' | 'resumen';

/** AE9 — slice del conduce persistido para retomar el borrador (sin fotos/firmas). */
interface ConduceDraft {
  origenTipo: OrigenTipo;
  bodegaId: string;
  obraId: string;
  destinoTipo: 'obra' | 'suplidor' | 'almacen';
  almacenId?: string; // AL10
  suplidorNombre: string;
  ferreteriaId: string;
  referencia: string;
  observaciones: string;
  vehiculoId: string;
  despachanteId: string;
  despachanteLibre: string;
  cart: CartLinea[];
  itemsLibres?: ItemLibre[]; // AU4
}

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
  imports: [FormsModule, DecimalPipe, CollapsibleSelect, OptionButton, WizardFooter, StepBar, ArticuloPicker, ConfirmDialog, BigConfirm, PhotoSlot, SignaturePad, DraftBanner],
  templateUrl: './generar-conduce.html',
  styleUrl: './generar-conduce.scss',
})
export class GenerarConducePage implements OnDestroy {
  private inventario = inject(InventarioService);
  private conduces = inject(ConducesService);
  private vehiculos = inject(VehiculosService);
  private ctx = inject(UserContextService);
  private tracking = inject(TrackingService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private sync = inject(SyncService);

  // AE9 — borrador persistente del conduce (rehidrata al reabrir; fotos/firmas se re-capturan).
  private readonly clave = 'transporte:generar-conduce';
  draftFecha = signal<number | null>(null);
  private hydrated = false;

  /** AG15 — id de la tarea que originó este conduce (se enlaza al emitir). */
  private tareaVinculada: string | null = null;

  /** AJ6 — contexto con el que se cargaron los despachantes (evita recargas). */
  private despachantesKey = '';

  // AI2 — dos firmas al emitir: chofer (transportista) + despachante (emisor).
  private sigChofer = viewChild<SignaturePad>('choferPad');
  private sigDespachante = viewChild<SignaturePad>('despachantePad');

  hoja = signal<'form' | 'exito'>('form');
  // AO4 — id del conduce recién emitido (para "Ver / compartir conduce" en el éxito).
  conduceCreadoId = signal<string | null>(null);
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

  // AF31 — destino: obra (normal), suplidor (devolución de equipo alquilado, texto)
  // o AL10 — almacén central (Bodega Central / almacenes principales).
  destinoTipo = signal<'obra' | 'suplidor' | 'almacen'>('obra');
  suplidorNombre = signal('');

  // AL10 — almacenes centrales elegibles como destino (Bodega Central primero).
  almacenes = signal<AlmacenDestino[]>([]);
  almacenId = signal('');
  almacenOptions = computed(() =>
    this.almacenes().map((a) => ({ id: a.id, label: a.es_central ? `🏢 ${a.nombre}` : a.nombre })),
  );
  // AO — destino "Almacén central" = **Bodega Central directo** (sin picker). La obra
  // ya cubre el almacén de su obra (obra X ≡ almacén de obra X), así que "Almacén
  // central" solo puede significar la bodega central/principal. Se autoselecciona; si
  // por alguna razón hay más de un almacén central, se ofrece "Cambiar".
  almacenCentral = computed<AlmacenDestino | null>(
    () =>
      this.almacenes().find((a) => a.es_central) ??
      this.almacenes().find((a) => a.es_principal) ??
      this.almacenes()[0] ??
      null,
  );
  editarAlmacen = signal(false);
  almacenSelNombre = computed(
    () => this.almacenes().find((a) => a.id === this.almacenId())?.nombre ?? this.almacenCentral()?.nombre ?? '',
  );

  // AF31 — ferreterías (origen = compra/entrada).
  ferreterias = signal<Ferreteria[]>([]);
  ferreteriaId = signal('');
  referencia = signal('');
  fotoRecibo = signal<CapturedPhoto | null>(null);
  fotoMercancia = signal<CapturedPhoto | null>(null);

  articulos = signal<ArticuloCat[]>([]);
  categorias = signal<CategoriaInv[]>([]);
  cart = signal<CartLinea[]>([]);
  private existencias = signal<Record<string, number>>({});

  // AU4 — materiales NO catalogados (nota libre): nombre + cantidad + unidad. No
  // tocan stock; viajan en el conduce y alertan al admin para crear el artículo.
  itemsLibres = signal<ItemLibre[]>([]);
  mostrarFormLibre = signal(false);
  libreNombre = signal('');
  libreCantidad = signal(1);
  libreUnidad = signal('');
  /** Normaliza para buscar: minúsculas + sin acentos (el chofer teclea sin tildes). */
  private normalizar(s: string): string {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  /** AU4/AW6 — sugerencias del catálogo mientras el chofer escribe un material
   *  libre (para evitar duplicar el catálogo). Ahora usa la búsqueda FUZZY del
   *  server (`buscar_articulos`: tolera tipeo/acentos/orden/código), con fallback
   *  a la caché offline. Debounce 350 ms. */
  sugerenciasLibre = signal<ArticuloCat[]>([]);
  private libreTimer: ReturnType<typeof setTimeout> | null = null;

  onLibreNombre(v: string): void {
    this.libreNombre.set(v);
    if (this.libreTimer) clearTimeout(this.libreTimer);
    const q = v.trim();
    if (q.length < 2) {
      this.sugerenciasLibre.set([]);
      return;
    }
    this.libreTimer = setTimeout(() => void this.buscarSugerenciasLibre(q), 350);
  }

  /** AW6 — buscador fuzzy (server, pg_trgm) para el articulo-picker principal. */
  buscarArticulosFuzzy = (q: string): Promise<ArticuloCat[]> => this.inventario.buscarArticulos(q, 12);

  private async buscarSugerenciasLibre(q: string): Promise<void> {
    const enCarrito = new Set(this.cart().map((l) => l.articulo_id));
    // Fuzzy server-side; si no hay red/resultados, cae a la caché local (substring sin acentos).
    let res = await this.inventario.buscarArticulos(q, 8).catch(() => [] as ArticuloCat[]);
    if (!res.length) {
      const qn = this.normalizar(q);
      res = this.articulos().filter(
        (a) => this.normalizar(a.nombre).includes(qn) || this.normalizar(a.codigo).includes(qn),
      );
    }
    if (this.libreNombre().trim() !== q) return; // el texto cambió mientras resolvía
    this.sugerenciasLibre.set(res.filter((a) => !enCarrito.has(a.id)).slice(0, 5));
  }
  itemsLibresCount = computed(() => this.itemsLibres().length);

  // AF23.4 — vehículo (para que el servidor auto-genere la ruta al emitir).
  misVehiculos = signal<MiAsignacion[]>([]);
  // AI6 — todos los vehículos visibles (para poder elegir uno no asignado → Uso de vehículo).
  todosVehiculos = signal<VehiculoDisponible[]>([]);
  vehiculoId = signal('');
  vehiculoOptions = computed(() =>
    this.todosVehiculos().map((v) => ({ id: v.vehiculo_id, label: `${v.placa} · ${v.marca} ${v.modelo}` })),
  );
  /** AI6 — ¿el vehículo elegido está asignado al chofer actual? */
  private esVehiculoAsignado(id: string): boolean {
    return this.misVehiculos().some((v) => v.vehiculo_id === id);
  }
  // AI2 — foto de recepción (el chofer CARGA el material del despachante) — solo cámara.
  fotoRecepcion = signal<CapturedPhoto | null>(null);
  // AI2 — despachante: quien entrega el material al chofer (select de personas del
  // origen; nombre libre si el origen es ferretería/otros).
  despachantes = signal<Despachante[]>([]);
  despachanteId = signal(''); // usuario/empleado seleccionado
  despachanteLibre = signal(''); // nombre libre (otros)
  // AI2 — firmas de emisión: chofer (transportista) + despachante (emisor).
  firmaChofer = signal<Blob | null>(null);
  firmaDespachante = signal<Blob | null>(null);

  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  obraOptions = computed(() => this.obras().map((o) => ({ id: o.id, label: o.nombre })));
  ferreteriaOptions = computed(() => this.ferreterias().map((f) => ({ id: f.id, label: f.nombre })));
  // AI2 — opciones del despachante (usuario/empleado). El id es namespaced por tipo
  // para distinguir usuario↔empleado con el mismo uuid poco probable, pero seguro.
  despachanteOptions = computed(() =>
    this.despachantes().map((d) => ({
      id: `${d.tipo}:${d.id}`,
      label: d.detalle ? `${d.nombre} · ${d.detalle}` : d.nombre,
    })),
  );
  despachanteSel = computed<Despachante | null>(() => {
    const key = this.despachanteId();
    if (!key) return null;
    const [tipo, id] = key.split(':');
    return this.despachantes().find((d) => d.tipo === tipo && d.id === id) ?? null;
  });
  /** Nombre del despachante para el conduce (picker o libre). */
  despachanteNombre = computed(() => this.despachanteSel()?.nombre ?? this.despachanteLibre().trim());
  despachanteOk = computed(() => !!(this.despachanteId() || this.despachanteLibre().trim()));
  excludeIds = computed(() => this.cart().map((l) => l.articulo_id).filter((x): x is string => !!x));
  faltaItems = computed(() => this.cart().filter((l) => l.cantidad > 0).length === 0);
  hayExceso = computed(() => this.cart().some((l) => this.excedeStock(l)));

  // ¿El origen es una ferretería? (compra/entrada, sin ruta/firma/vehículo)
  esFerreteria = computed(() => this.origenTipo() === 'ferreteria');

  // AJ6 — etiquetas legibles para la hoja de resumen.
  origenNombre = computed(() => {
    if (this.esFerreteria()) return this.ferreterias().find((f) => f.id === this.ferreteriaId())?.nombre ?? '';
    return this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '';
  });
  destinoNombre = computed(() => {
    if (this.esFerreteria()) return this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '';
    if (this.destinoTipo() === 'obra') return this.obras().find((o) => o.id === this.obraId())?.nombre ?? '';
    if (this.destinoTipo() === 'almacen') return this.almacenes().find((a) => a.id === this.almacenId())?.nombre ?? '';
    return this.suplidorNombre().trim();
  });
  vehiculoNombre = computed(() => {
    const v = this.todosVehiculos().find((x) => x.vehiculo_id === this.vehiculoId());
    return v ? `${v.placa} · ${v.marca} ${v.modelo}` : '';
  });
  itemsCount = computed(() => this.cart().filter((l) => l.cantidad > 0).length);
  /** AL12 — items del resumen (nombre + cantidad + unidad). */
  itemsResumen = computed(() => this.cart().filter((l) => l.cantidad > 0));
  /**
   * AS4 — el origen no puede ser igual al destino (p. ej. Bodega Central → Bodega
   * Central). Solo aplica cuando el destino es un almacén (la obra ≡ su propio
   * almacén y el suplidor es texto). Compara por id y, por si el id-space difiere,
   * también por nombre normalizado. El servidor lo revalida (trigger
   * tg_conduce_origen_distinto_destino).
   */
  mismoOrigenDestino = computed(() => {
    if (this.esFerreteria() || this.destinoTipo() !== 'almacen') return false;
    const o = this.bodegaId();
    const d = this.almacenId();
    if (o && d && o === d) return true;
    const on = this.origenNombre().trim().toLowerCase();
    const dn = this.destinoNombre().trim().toLowerCase();
    return !!on && on === dn;
  });

  /** ¿El destino elegido es válido? (obra | suplidor | almacén central AL10) */
  destinoOk = computed(() => {
    if (this.mismoOrigenDestino()) return false; // AS4
    if (this.destinoTipo() === 'obra') return !!this.obraId();
    if (this.destinoTipo() === 'almacen') return !!this.almacenId();
    return !!this.suplidorNombre().trim();
  });

  /** AS2 — al emitir solo se exige la firma del CHOFER. La firma del despachante
   *  es remota (firma desde su propio teléfono, anti-fraude); el servidor bloquea
   *  la ENTREGA hasta que firme (DR456). */
  private firmasOk = computed(() => !!this.firmaChofer());

  /** AS2 — ¿el despachante es un usuario del sistema? (solo esos firman remoto). */
  despachanteEsSistema = computed(() => this.despachanteSel()?.tipo === 'usuario');

  /** ¿Están los campos mínimos para emitir según el tipo de origen? */
  puedeEmitir = computed(() => {
    if (this.esFerreteria()) return !!(this.ferreteriaId() && this.bodegaId() && this.fotoRecibo());
    const destinoOk = this.destinoOk();
    // AI2 — el conduce exige: origen, destino, materiales, foto de recepción,
    // despachante y ambas firmas (chofer + despachante).
    const comun = destinoOk && !!this.fotoRecepcion() && this.despachanteOk() && this.firmasOk();
    return !!(this.bodegaId() && !this.faltaItems() && comun);
  });

  /** Etiqueta del botón EMITIR según el modo (compra vs conduce). */
  primaryLabel = computed(() =>
    this.submitting() ? 'Guardando…' : this.esFerreteria() ? 'Registrar compra' : 'Generar conduce',
  );

  // ══════════ AJ6 — wizard por hojas (una pregunta por pantalla) ══════════
  paso = signal(0);

  /** Hojas del wizard según el tipo de origen (patrón bitácora). */
  pasos = computed<{ key: PasoKey; titulo: string }[]>(() => {
    if (this.esFerreteria()) {
      return [
        { key: 'origen', titulo: 'Compra en ferretería' },
        { key: 'materiales', titulo: '¿Qué compraste?' },
        { key: 'ferr-fotos', titulo: 'Fotos' },
        { key: 'resumen', titulo: 'Revisar y registrar' },
      ];
    }
    const p: { key: PasoKey; titulo: string }[] = [
      { key: 'origen', titulo: '¿De dónde sale?' },
      { key: 'destino', titulo: '¿A dónde va?' },
      { key: 'materiales', titulo: '¿Qué material sacas?' },
    ];
    p.push({ key: 'foto', titulo: 'Foto de recepción' });
    p.push({ key: 'despacho', titulo: 'Despachante y firmas' });
    p.push({ key: 'resumen', titulo: 'Revisar y emitir' });
    return p;
  });

  pasoActual = computed(() => this.pasos()[Math.min(this.paso(), this.pasos().length - 1)]);
  esUltimo = computed(() => this.paso() >= this.pasos().length - 1);

  /** Validación de la hoja actual: habilita "Siguiente" / "Emitir". */
  pasoValido = computed(() => {
    switch (this.pasoActual()?.key) {
      case 'origen':
        if (this.esFerreteria()) return !!(this.ferreteriaId() && this.bodegaId());
        return !!this.bodegaId();
      case 'destino':
        return this.destinoOk();
      case 'materiales':
        if (this.esFerreteria()) return true; // opcional en compra
        return !this.faltaItems() && !this.hayExceso();
      case 'ferr-fotos':
        return !!this.fotoRecibo();
      case 'foto':
        return !!this.fotoRecepcion();
      case 'despacho':
        return this.despachanteOk() && this.firmasOk();
      case 'resumen':
        return this.puedeEmitir();
      default:
        return false;
    }
  });

  /** Etiqueta del botón primario del footer (avanzar u emitir). */
  primaryBtn = computed(() => (this.esUltimo() ? this.primaryLabel() : 'Siguiente'));

  siguiente(): void {
    if (!this.pasoValido() || this.submitting()) return;
    if (this.esUltimo()) return void this.submit();
    this.paso.update((p) => Math.min(p + 1, this.pasos().length - 1));
  }

  atras(): void {
    if (this.paso() === 0) return this.intentarSalir();
    this.paso.update((p) => p - 1);
  }

  private readonly backHandler = (): boolean => {
    if (this.hoja() !== 'form') return false;
    if (this.confirmSalir()) {
      this.confirmSalir.set(false); // back cierra el diálogo de salida
      return true;
    }
    if (this.paso() > 0) {
      this.paso.update((p) => p - 1); // back = hoja anterior
      return true;
    }
    if (this.tieneDatos()) {
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
    // AJ6 — al fijar origen/destino, recarga los despachantes con contexto para que
    // los vinculados a esa obra/almacén salgan primero (server-side).
    effect(() => {
      if (this.esFerreteria()) return;
      const key = `${this.bodegaId()}|${this.obraId()}`;
      if (key === this.despachantesKey || !(this.bodegaId() || this.obraId())) return;
      this.despachantesKey = key;
      void this.conduces
        .despachantesDisponibles(this.bodegaId() || null, this.obraId() || null)
        .then((d) => this.despachantes.set(d))
        .catch(() => {});
    });
    // AO — destino "Almacén central": autoselecciona la Bodega Central (al elegir la
    // opción y también cuando los almacenes terminen de cargar). No pisa una elección
    // manual (solo actúa si aún no hay almacén elegido).
    effect(() => {
      if (this.destinoTipo() === 'almacen' && !this.almacenId()) {
        const c = this.almacenCentral();
        if (c) this.almacenId.set(c.id);
      }
    });
    // AE9 — autosave del borrador (sin fotos/firmas): al cambiar cualquier campo.
    effect(() => this.autosaveEffect());
  }

  /** AO — cambiar manualmente el almacén central (caso raro de >1 central). */
  onAlmacenElegido(id: string): void {
    this.almacenId.set(id);
    this.editarAlmacen.set(false);
  }

  /** AE9 — snapshot + autosave del borrador (se dispara con cualquier cambio). */
  private autosaveEffect(): void {
    const snap: ConduceDraft = {
      origenTipo: this.origenTipo(),
      bodegaId: this.bodegaId(),
      obraId: this.obraId(),
      destinoTipo: this.destinoTipo(),
      almacenId: this.almacenId(), // AL10
      suplidorNombre: this.suplidorNombre(),
      ferreteriaId: this.ferreteriaId(),
      referencia: this.referencia(),
      observaciones: this.observaciones(),
      vehiculoId: this.vehiculoId(),
      despachanteId: this.despachanteId(),
      despachanteLibre: this.despachanteLibre(),
      cart: this.cart(),
      itemsLibres: this.itemsLibres(), // AU4
    };
    if (!this.hydrated || this.hoja() === 'exito' || this.submitting()) return;
    if (!this.tieneDatos()) return;
    this.autosave.queue(this.clave, snap, {
      tipo: 'conduce',
      etiqueta: 'Conduce',
      ruta: this.location.path(),
    });
  }

  /** AE9 — retomar el borrador: rehidrata los campos (fotos/firmas se re-capturan). */
  continuarBorrador(): void {
    void (async () => {
      const d = await this.borrador.load<ConduceDraft>(this.clave);
      if (d) {
        this.origenTipo.set(d.origenTipo ?? 'almacen');
        this.bodegaId.set(d.bodegaId ?? '');
        this.obraId.set(d.obraId ?? '');
        this.destinoTipo.set(d.destinoTipo ?? 'obra');
        this.almacenId.set(d.almacenId ?? ''); // AL10
        this.suplidorNombre.set(d.suplidorNombre ?? '');
        this.ferreteriaId.set(d.ferreteriaId ?? '');
        this.referencia.set(d.referencia ?? '');
        this.observaciones.set(d.observaciones ?? '');
        this.vehiculoId.set(d.vehiculoId ?? '');
        this.despachanteId.set(d.despachanteId ?? '');
        this.despachanteLibre.set(d.despachanteLibre ?? '');
        this.cart.set(d.cart ?? []);
        this.itemsLibres.set(d.itemsLibres ?? []); // AU4
      }
      // QA-7 — rehidrata la foto de recepción + ambas firmas persistidas antes del
      // desvío a "Uso de vehículo" (así el chofer no re-toma foto ni re-firma dos veces).
      const fotos = await this.borrador.loadFotos(this.clave);
      for (const f of fotos) {
        if (f.slot === 'recepcion') this.fotoRecepcion.set({ blob: f.blob, previewUrl: URL.createObjectURL(f.blob) });
        else if (f.slot === 'firma_chofer') this.firmaChofer.set(f.blob);
        else if (f.slot === 'firma_despachante') this.firmaDespachante.set(f.blob);
      }
      this.draftFecha.set(null);
      this.hydrated = true;
    })();
  }

  /** AE9 — empezar de nuevo: descarta el borrador. */
  descartarBorrador(): void {
    void this.autosave.discard(this.clave);
    this.draftFecha.set(null);
    this.hydrated = true;
  }

  /**
   * AO3 — reconstruye un conduce ATASCADO (op del outbox con error, ej. "Stock
   * insuficiente") como borrador editable: mapea el payload a los campos del wizard,
   * copia sus fotos/firmas al borrador (para no perderlas), descarta la op atascada y
   * rehidrata. El chofer corrige las cantidades/almacén y reenvía. Solo conduce_simple.
   */
  private async cargarCorreccion(opId: string): Promise<void> {
    const op = await this.sync.getOp(opId);
    if (!op || op.tipo_op !== 'conduce_simple') {
      this.hydrated = true;
      this.toast.error('No se pudo abrir ese conduce para corregir.');
      return;
    }
    const p = op.payload as Record<string, unknown>;
    // Reconstruye el carrito resolviendo nombre/unidad desde el catálogo ya cargado.
    const items = (p['items'] as { articulo_id: string; cantidad: number }[]) ?? [];
    const cart: CartLinea[] = items.map((it) => {
      const art = this.articulos().find((a) => a.id === it.articulo_id);
      return {
        articulo_id: it.articulo_id,
        nombre: art?.nombre ?? 'Material',
        unidad: art?.unidad ?? 'u',
        categoria_id: art?.categoria_id ?? null,
        cantidad: it.cantidad,
      };
    });
    // Despachante: reusa el picker si el id sigue disponible; si no, cae al nombre libre.
    const dU = p['despachante_usuario_id'] as string | null;
    const dE = p['despachante_empleado_id'] as string | null;
    let despachanteId = '';
    if (dU && this.despachantes().some((d) => d.tipo === 'usuario' && d.id === dU)) despachanteId = `usuario:${dU}`;
    else if (dE && this.despachantes().some((d) => d.tipo === 'empleado' && d.id === dE)) despachanteId = `empleado:${dE}`;
    const draft: ConduceDraft = {
      origenTipo: 'almacen',
      bodegaId: (p['bodega_id'] as string) ?? '',
      obraId: (p['proyecto_id'] as string) ?? '',
      destinoTipo: p['destino_almacen_id'] ? 'almacen' : 'obra',
      almacenId: (p['destino_almacen_id'] as string) ?? '',
      suplidorNombre: '',
      ferreteriaId: '',
      referencia: '',
      observaciones: (p['observaciones'] as string) ?? '',
      vehiculoId: (p['vehiculo_id'] as string) ?? '',
      despachanteId,
      despachanteLibre: despachanteId ? '' : ((p['despachante_nombre'] as string) ?? ''),
      cart,
    };
    // Copia las fotos/firmas de la op ANTES de descartarla (no perder evidencia). El
    // wizard espera el slot 'recepcion' para la foto de carga (en la op es 'carga').
    const fotos = await this.sync.getOpFotos(opId);
    await this.borrador.save(this.clave, draft, { tipo: 'conduce', etiqueta: 'Conduce', ruta: this.location.path() });
    for (const f of fotos) {
      await this.borrador.saveFoto(this.clave, f.slot === 'carga' ? 'recepcion' : f.slot, f.blob);
    }
    // Saca el conduce atascado del outbox: se recreará corregido al reenviar.
    await this.sync.discard(opId);
    // Rehidrata como un borrador normal y lleva al paso de materiales (donde se corrige).
    this.continuarBorrador();
    const idx = this.pasos().findIndex((x) => x.key === 'materiales');
    if (idx >= 0) this.paso.set(idx);
    this.toast.show('Corrige las cantidades y vuelve a enviar el conduce.', 'info', 6000);
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

  /** AO3 — mapa de stock para el buscador de materiales: solo cuando el origen es un
   *  almacén Y ya hay existencias cargadas (del último sync). `null` offline → el picker
   *  no marca ni deshabilita nada (no hay dato que mostrar). */
  stockParaPicker = computed<Record<string, number> | null>(() =>
    this.origenTipo() === 'almacen' && Object.keys(this.existencias()).length > 0
      ? this.existencias()
      : null,
  );

  /** AO3 — ¿hay stock cargado del almacén de origen? (si no, avisamos que es sin verificar). */
  stockSinVerificar = computed(
    () => this.origenTipo() === 'almacen' && Object.keys(this.existencias()).length === 0,
  );

  /** AO3 — tope de cantidad de una línea: el disponible del almacén, o Infinity si no
   *  aplica el chequeo (ferretería) o no hay dato (offline). */
  private topeStock(articuloId: string): number {
    if (this.origenTipo() !== 'almacen') return Infinity;
    const s = this.stockDe(articuloId);
    return s == null ? Infinity : s;
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async init(): Promise<void> {
    this.loading.set(true);
    try {
      const [b, obras, a, cat, asig, todos, ferr, desp] = await Promise.all([
        this.inventario.getBodegas(),
        // AP1 — obras de destino por el directorio de referencia (arregla el "No hay
        // opciones." del chofer: obras_con_bodega le devolvía [] por la RLS de proyectos).
        this.inventario.getObrasDestino().catch(() => [] as ObraOrigen[]),
        this.inventario.getArticulos().catch(() => [] as ArticuloCat[]),
        this.inventario.getCategorias().catch(() => [] as CategoriaInv[]),
        this.vehiculos.getMisAsignaciones().catch(() => [] as MiAsignacion[]),
        this.vehiculos.getVehiculosDisponibles().catch(() => [] as VehiculoDisponible[]),
        this.inventario.getFerreterias().catch(() => [] as Ferreteria[]),
        this.conduces.despachantesDisponibles().catch(() => [] as Despachante[]),
      ]);
      this.bodegas.set(b);
      this.obras.set(obras);
      this.articulos.set(a);
      this.categorias.set(cat);
      this.misVehiculos.set(asig);
      this.todosVehiculos.set(todos);
      this.ferreterias.set(ferr);
      this.despachantes.set(desp);
      // AL10 — almacenes centrales elegibles como destino (best-effort).
      void this.conduces.almacenesDestino().then((al) => this.almacenes.set(al)).catch(() => {});
      if (b.length === 1) this.bodegaId.set(b[0].id);
      if (asig.length === 1) this.vehiculoId.set(asig[0].vehiculo_id);
      // AO3 — ¿venimos a CORREGIR un conduce atascado en el outbox? (acceso directo
      // desde el error de "Pendientes de envío"). Reconstruye el borrador desde el
      // payload, conserva fotos/firmas y descarta la op atascada; el chofer ajusta las
      // cantidades/almacén y reenvía.
      const corregirId = this.route.snapshot.queryParamMap.get('corregir');
      if (corregirId) {
        await this.cargarCorreccion(corregirId);
        return;
      }
      const deepLink = this.prefillFromQuery(); // AG15 — pre-llenar si viene de una tarea vinculada
      // AE9 — si NO viene de deep-link, ofrecer retomar un borrador previo (banner).
      if (!deepLink) {
        const d = await this.borrador.get(this.clave);
        if (d) {
          this.draftFecha.set(d.updated_at);
          // QA-7 — al volver al conduce, si el desvío "Uso de vehículo" quedó a medias,
          // re-habilita el desvío para que se pueda volver a disparar.
          await this.limpiarDesvioSiAbandonado((d.data as ConduceDraft | undefined)?.vehiculoId);
        } else this.hydrated = true;
      } else {
        this.hydrated = true;
      }
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
  private prefillFromQuery(): boolean {
    const q = this.route.snapshot.queryParamMap;
    let deepLink = false;
    const origen = q.get('origen') as OrigenTipo | null;
    if (origen === 'almacen' || origen === 'ferreteria') {
      this.setOrigen(origen);
      deepLink = true;
    }
    const bodega = q.get('bodega');
    if (bodega && this.bodegas().some((b) => b.id === bodega)) { this.bodegaId.set(bodega); deepLink = true; }
    const ferreteria = q.get('ferreteria');
    if (ferreteria && this.ferreterias().some((f) => f.id === ferreteria)) {
      this.ferreteriaId.set(ferreteria);
      deepLink = true;
    }
    const obra = q.get('obra');
    if (obra && this.obras().some((o) => o.id === obra)) {
      this.destinoTipo.set('obra');
      this.obraId.set(obra);
      deepLink = true;
    }
    // AJ8 — "Devolver a suplidor" abre el conduce con destino suplidor pre-fijado.
    if (q.get('destino') === 'suplidor') {
      this.destinoTipo.set('suplidor');
      deepLink = true;
    }
    this.tareaVinculada = q.get('tarea');
    if (this.tareaVinculada) deepLink = true;
    return deepLink;
  }

  /** AF31 — cambiar el tipo de origen limpia lo que no aplica. */
  setOrigen(t: OrigenTipo): void {
    this.origenTipo.set(t);
    if (t !== 'almacen') this.destinoTipo.set('obra');
  }

  onFerreteria(id: string): void {
    this.ferreteriaId.set(id);
  }

  // ---- Materiales ----
  agregar(a: ArticuloCat): void {
    // AO3 — no se agrega un material sin existencia en el almacén de origen (el picker
    // ya lo deshabilita; esto es el segundo cerrojo por si se llama directo).
    if (this.origenTipo() === 'almacen') {
      const s = this.stockDe(a.id);
      if (s != null && s <= 0) {
        this.toast.error(`No hay existencia de "${a.nombre}" en el almacén de origen.`);
        return;
      }
    }
    this.cart.update((list) => {
      if (list.some((l) => l.articulo_id === a.id)) return list;
      // AO3 — arranca en 1, pero nunca por encima del disponible.
      const cant = Math.min(1, this.topeStock(a.id));
      return [
        { articulo_id: a.id, nombre: a.nombre, unidad: a.unidad, categoria_id: a.categoria_id ?? null, cantidad: cant },
        ...list,
      ];
    });
  }
  ajustar(articuloId: string, delta: number): void {
    // AO3 — tope inmediato al disponible del almacén (no deja subir más de lo que hay).
    const tope = this.topeStock(articuloId);
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: Math.min(tope, Math.max(0, l.cantidad + delta)) } : l)).filter((l) => l.cantidad > 0),
    );
  }
  setCantidad(articuloId: string, v: number): void {
    // AO3 — clamp a [0, disponible]: escribir más de lo que hay se corta al máximo.
    const cant = Math.min(this.topeStock(articuloId), Math.max(0, v || 0));
    this.cart.update((list) =>
      list.map((l) => (l.articulo_id === articuloId ? { ...l, cantidad: cant } : l)).filter((l) => l.cantidad > 0),
    );
  }
  quitar(articuloId: string): void {
    this.cart.update((list) => list.filter((l) => l.articulo_id !== articuloId));
  }

  // ---- AU4 — item libre (material no catalogado) ----
  abrirFormLibre(): void {
    this.mostrarFormLibre.set(true);
  }
  cancelarLibre(): void {
    this.mostrarFormLibre.set(false);
    this.libreNombre.set('');
    this.libreCantidad.set(1);
    this.libreUnidad.set('');
  }
  /** El usuario eligió una sugerencia del catálogo → mejor agregarla como item normal. */
  usarSugerencia(a: ArticuloCat): void {
    this.agregar(a);
    this.cancelarLibre();
  }
  agregarItemLibre(): void {
    const nombre = this.libreNombre().trim();
    if (!nombre) {
      this.toast.error('Escribe el nombre del material.');
      return;
    }
    const cantidad = Math.max(1, Number(this.libreCantidad()) || 1);
    const unidad = this.libreUnidad().trim() || 'u';
    this.itemsLibres.update((list) => [{ nombre, cantidad, unidad }, ...list]);
    this.cancelarLibre();
  }
  quitarItemLibre(index: number): void {
    this.itemsLibres.update((list) => list.filter((_, i) => i !== index));
  }

  async onFirmaChofer(has: boolean): Promise<void> {
    this.firmaChofer.set(has ? ((await this.sigChofer()?.toBlob()) ?? null) : null);
  }
  async onFirmaDespachante(has: boolean): Promise<void> {
    this.firmaDespachante.set(has ? ((await this.sigDespachante()?.toBlob()) ?? null) : null);
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.origenTipo() === 'ferreteria') return void this.submitFerreteria();
    return void this.submitConduce();
  }

  /**
   * AI6 — si el chofer elige un vehículo que NO tiene asignado, lo mandamos primero
   * al flujo "Uso de vehículo" (asignarme) con el vehículo preseleccionado; al
   * terminarlo vuelve a este conduce (el borrador AE9 se guardó). Devuelve true si
   * desvió (el caller debe abortar el submit). Los roles elevados no se desvían.
   */
  private async desviarAUsoDeVehiculo(): Promise<boolean> {
    const vId = this.vehiculoId();
    if (!vId || this.ctx.esFlotaElevado() || this.esVehiculoAsignado(vId)) return false;
    // Evita el bucle si el traspaso aún no sincronizó (offline): solo desviamos una
    // vez por vehículo en esta sesión.
    const key = `ai6-uso:${vId}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
    } catch { /* sessionStorage no disponible */ }
    this.toast.show('Primero registra el uso de este vehículo.', 'info');
    // QA-7 — persiste la foto de recepción + AMBAS firmas en borrador_fotos para no
    // perderlas en el desvío a "Uso de vehículo" (el texto ya lo guarda el autosave AE9).
    const foto = this.fotoRecepcion();
    if (foto) await this.borrador.saveFoto(this.clave, 'recepcion', foto.blob);
    const fCh = this.firmaChofer();
    if (fCh) await this.borrador.saveFoto(this.clave, 'firma_chofer', fCh);
    const fDe = this.firmaDespachante();
    if (fDe) await this.borrador.saveFoto(this.clave, 'firma_despachante', fDe);
    await this.autosave.flushAll(); // AE9 — persiste el borrador antes de salir
    const returnUrl = this.router.url;
    await this.router.navigate(['/transporte/asignarme'], {
      queryParams: { returnUrl, vehiculoId: vId },
    });
    return true;
  }

  /**
   * QA-7 — si volvemos al conduce y el vehículo AÚN no está asignado estando ONLINE,
   * el chofer se salió de "Uso de vehículo" sin completarlo → limpiamos el flag de
   * sesión para que el desvío se pueda volver a disparar. Offline NO se puede
   * distinguir de un traspaso encolado sin sincronizar, así que ahí conservamos el
   * guardia anti-bucle (AI6).
   */
  private async limpiarDesvioSiAbandonado(vId: string | null | undefined): Promise<void> {
    if (!vId) return;
    const key = `ai6-uso:${vId}`;
    try {
      if (!sessionStorage.getItem(key)) return;
      if (this.network.online() && !this.esVehiculoAsignado(vId)) {
        sessionStorage.removeItem(key);
      }
    } catch { /* sessionStorage no disponible */ }
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
      void this.autosave.discard(this.clave); // AE9 — borrador cumplido
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo registrar la compra.');
    } finally {
      this.submitting.set(false);
    }
  }

  /** Almacén (salida) → conduce (+ ruta al emitir). */
  private async submitConduce(): Promise<void> {
    if (!this.bodegaId()) {
      this.toast.error('Elige el almacén de origen.');
      return;
    }
    // Destino: obra, almacén central (AL10) o suplidor (devolución de alquiler).
    if (this.destinoTipo() === 'obra' && !this.obraId()) {
      this.toast.error('Elige la obra destino.');
      return;
    }
    if (this.destinoTipo() === 'almacen' && !this.almacenId()) {
      this.toast.error('Elige el almacén destino.');
      return;
    }
    if (this.destinoTipo() === 'suplidor' && !this.suplidorNombre().trim()) {
      this.toast.error('Escribe el suplidor al que devuelves.');
      return;
    }
    if (this.faltaItems()) {
      this.toast.error('Agrega al menos un material.');
      return;
    }
    // AO3 — cerrojo duro: nunca emitir sacando más de lo disponible (defensa en
    // profundidad; el paso ya lo bloquea y el server rechaza con AM1, pero así ni se crea
    // el conduce que luego moriría en el outbox por "Stock insuficiente").
    if (this.hayExceso()) {
      this.toast.error('Estás sacando más de lo disponible en algún material. Ajusta las cantidades.');
      return;
    }
    if (!this.fotoRecepcion()) {
      this.toast.error('Toma la foto de recepción (el material que cargas).');
      return;
    }
    if (!this.despachanteOk()) {
      this.toast.error('Elige (o escribe) quién despacha el material.');
      return;
    }
    if (!this.firmaChofer()) {
      this.toast.error('Falta tu firma (chofer).');
      return;
    }
    // AI6 — vehículo distinto al asignado → primero "Uso de vehículo" (vuelve al borrador).
    if (await this.desviarAUsoDeVehiculo()) return;
    if (!(await this.tracking.exigirGps('crear_conduce'))) return;
    this.submitting.set(true);
    try {
      // Observaciones enriquecidas con destino suplidor.
      const partes: string[] = [];
      if (this.destinoTipo() === 'suplidor') partes.push(`Devolución a suplidor: ${this.suplidorNombre().trim()}`);
      if (this.observaciones().trim()) partes.push(this.observaciones().trim());
      const obs = partes.join(' — ') || null;

      const sel = this.despachanteSel();
      const items = this.cart().filter((l) => l.cantidad > 0 && l.articulo_id).map((l) => ({ articulo_id: l.articulo_id!, cantidad: l.cantidad }));

      // AM1 — devolución a suplidor: RPC dedicada con ORIGEN (bodega) obligatorio.
      // Nunca puede emitir con bodega_id null (server rechaza con DR451).
      if (this.destinoTipo() === 'suplidor') {
        const nid = await this.conduces.crearConduceDevolucionSuplidor({
          bodegaOrigenId: this.bodegaId(),
          proyectoOrigenId: null,
          suplidorNombre: this.suplidorNombre().trim(),
          observaciones: obs,
          vehiculoId: this.vehiculoId() || null,
          items,
          despachanteUsuarioId: sel?.tipo === 'usuario' ? sel.id : null,
          despachanteEmpleadoId: sel?.tipo === 'empleado' ? sel.id : null,
          despachanteNombre: this.despachanteNombre() || null,
          fotoRecepcion: this.fotoRecepcion()?.blob ?? null,
          firmaChofer: this.firmaChofer(),
          firmaDespachante: this.firmaDespachante(),
          itemsLibres: this.itemsLibres(), // AU4
        });
        this.conduceCreadoId.set(nid); // AO4
        void this.autosave.discard(this.clave); // AE9 — borrador cumplido
        this.hoja.set('exito');
        return;
      }

      // AI2 — conduce simplificado: despachante + foto de recepción + firmas
      // (chofer transportista + despachante emisor) en un solo RPC.
      const nid = await this.conduces.crearConduceSimple({
        bodegaId: this.bodegaId(),
        proyectoId: this.destinoTipo() === 'obra' ? this.obraId() : null,
        destinoAlmacenId: this.destinoTipo() === 'almacen' ? this.almacenId() : null, // AL10
        observaciones: obs,
        vehiculoId: this.vehiculoId() || null,
        items,
        despachanteUsuarioId: sel?.tipo === 'usuario' ? sel.id : null,
        despachanteEmpleadoId: sel?.tipo === 'empleado' ? sel.id : null,
        despachanteNombre: this.despachanteNombre() || null,
        fotoRecepcion: this.fotoRecepcion()?.blob ?? null,
        firmaChofer: this.firmaChofer(),
        firmaDespachante: this.firmaDespachante(),
        tareaVinculada: this.tareaVinculada, // AG15 — enlaza la tarea a esta salida
        itemsLibres: this.itemsLibres(), // AU4
      });
      this.conduceCreadoId.set(nid); // AO4 — para "Ver / compartir conduce" en el éxito
      void this.autosave.discard(this.clave); // AE9 — borrador cumplido
      this.hoja.set('exito');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo generar el conduce.');
    } finally {
      this.submitting.set(false);
    }
  }

  private tieneDatos(): boolean {
    return !!(
      this.bodegaId() || this.obraId() || this.almacenId() || this.ferreteriaId() ||
      this.suplidorNombre().trim() || this.observaciones().trim() || this.cart().length || this.itemsLibres().length ||
      this.fotoRecibo() || this.fotoMercancia() || this.fotoRecepcion() ||
      this.despachanteId() || this.despachanteLibre().trim() ||
      this.firmaChofer() || this.firmaDespachante()
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
    // AK9 — salir del wizard vuelve al HOME del módulo Conduce (conduces-hub),
    // nunca a "Mis rutas" (/transporte/conduces = ConducesPage). Back seguro con
    // POP real (AJ2): si se llegó por deep-link en frío, cae al hub sin salir.
    this.navGuard.back('/transporte/conduces-hub');
  }

  /** AO4 — abre el detalle del conduce recién emitido, donde ya existen Compartir
   *  (PDF por WhatsApp) y Descargar. Reemplaza el wizard en el historial de nav. */
  verConduce(): void {
    const id = this.conduceCreadoId();
    if (!id) return;
    void this.router.navigate(['/transporte/conduce-detalle', id], { replaceUrl: true });
  }

  get online(): boolean {
    return this.network.online();
  }
}
