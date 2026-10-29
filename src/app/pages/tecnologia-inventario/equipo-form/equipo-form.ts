import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { ToggleSwitch } from '../../../shared/ui/toggle-switch/toggle-switch';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { CameraService, CapturedPhoto } from '../../../core/services/camera.service';
import { InventarioService } from '../../../core/services/inventario.service';
import { Bodega } from '../../../core/models/inventario.model';
import { TecnologiaService } from '../../../core/services/tecnologia.service';
import { TecTipo, TecEquipoEstado, TecEquipoCondicion, TecCostoOrigen, TecEquipoSpecs } from '../../../core/models/tecnologia.model';
import { ToastService } from '../../../core/services/toast.service';
import { MOTION_DIRECTIVES } from '../../../shared/motion';

interface FotoItem {
  key: string; // path (existente) o uuid (nueva)
  path?: string; // storage path (existente)
  blob?: Blob; // captura nueva
  previewUrl: string;
}

const TOTAL = 9;
const COSTO_ORIGENES: [TecCostoOrigen, string][] = [
  ['compra', 'Compra'],
  ['estimado', 'Estimado'],
  ['donado', 'Donado'],
];

/**
 * AL2/DA — Alta/edición de un equipo tecnológico POR HOJAS: datos → tipo →
 * situación/condición → identificación → especificaciones (por tipo) →
 * ubicación/responsable → precio/garantía → fotos (+ especificaciones) →
 * resumen. Offline por outbox (campos base vía RPC, campos DA directo a tabla
 * dentro del mismo handler — ver TecnologiaService).
 */
@Component({
  selector: 'app-tec-equipo-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DecimalPipe,
    StepBar,
    WizardFooter,
    WizardExit,
    ConfirmDialog,
    OptionButton,
    CollapsibleSelect,
    ToggleSwitch,
    BigConfirm,
    ...MOTION_DIRECTIVES,
  ],
  templateUrl: './equipo-form.html',
  styleUrl: './equipo-form.scss',
})
export class TecEquipoFormPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private navGuard = inject(NavGuardService);
  private camera = inject(CameraService);
  private inventario = inject(InventarioService);
  private tec = inject(TecnologiaService);
  private toast = inject(ToastService);
  private location = inject(Location);

  readonly total = TOTAL;
  readonly costoOrigenes = COSTO_ORIGENES;

  equipoId = signal<string | null>(null); // edición
  loading = signal(true);
  step = signal(1);
  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false);

  // Datos
  nombre = signal('');
  marca = signal('');
  modelo = signal('');
  serie = signal('');
  // Tipo
  tipos = signal<TecTipo[]>([]);
  tipoId = signal('');
  nuevoTipo = signal('');
  agregandoTipo = signal(false);
  // Situación / condición (DA7 — catálogo, ya no enum fijo)
  estados = signal<TecEquipoEstado[]>([]);
  condiciones = signal<TecEquipoCondicion[]>([]);
  estado = signal('en_stock');
  condicion = signal('funciona');
  // Identificación (DA-02)
  serviceTag = signal('');
  codigoServicio = signal('');
  numeroParte = signal('');
  modeloRegulatorio = signal('');
  anioFabricacion = signal<number | null>(null);
  codigoAnterior = signal('');
  imei = signal('');
  etiquetaTaller = signal('');
  // Especificaciones (DA2) — solo las del/los bloque(s) que aplican al tipo
  procesador = signal('');
  ramGb = signal<number | null>(null);
  ramVelocidad = signal('');
  almacenamientoTipo = signal<'SSD' | 'HDD' | 'NVMe' | ''>('');
  almacenamientoGb = signal<number | null>(null);
  gpuIntegrada = signal('');
  gpuDedicada = signal('');
  gpuMemoriaGb = signal<number | null>(null);
  so = signal('');
  soVersion = signal('');
  pantallaPulgadas = signal<number | null>(null);
  resolucion = signal('');
  tactil = signal(false);
  nombreWindows = signal('');
  usuarioWindows = signal('');
  cargadorVoltaje = signal('');
  cargadorAmperaje = signal('');
  frecuencia = signal('');
  potenciaW = signal<number | null>(null);
  tipoRadio = signal<'frecuencia' | 'celular_ptt' | ''>('');
  selloTelserdomRadio = signal('');
  selloTelserdomBateria = signal('');
  bateriaModelo = signal('');
  bateriaCapacidad = signal<number | null>(null);
  bateriaUnidad = signal<'mAh' | 'Wh' | ''>('');
  bateriaVoltaje = signal('');
  bateriaSello = signal('');
  accesoriosTexto = signal(''); // coma-separado
  camaraSpecs = signal('');
  // Ubicación + responsable
  bodegas = signal<Bodega[]>([]);
  bodegaId = signal('');
  responsableExterno = signal('');
  // Precio + garantía
  costo = signal<number | null>(null);
  moneda = signal<'DOP' | 'USD'>('DOP');
  costoOrigen = signal<TecCostoOrigen>('compra');
  fechaCompra = signal('');
  fechaCompraDesconocida = signal(false);
  garantiaHasta = signal('');
  garantiaDesconocida = signal(false);
  // Notas
  notas = signal('');
  // Fotos
  fotos = signal<FotoItem[]>([]);
  portadaKey = signal<string | null>(null);
  fotosSpecs = signal<FotoItem[]>([]);

  tipoOptions = computed(() => this.tipos().map((t) => ({ id: t.id, label: t.label })));
  bodegaOptions = computed(() => this.bodegas().map((b) => ({ id: b.id, label: b.nombre })));
  tipoLabel = computed(() => this.tipos().find((t) => t.id === this.tipoId())?.label ?? '—');
  bodegaLabel = computed(() => this.bodegas().find((b) => b.id === this.bodegaId())?.nombre ?? '—');
  estadoOptions = computed(() => this.estados().map((e) => [e.clave, e.label] as [string, string]));
  condicionOptions = computed(() => this.condiciones().map((c) => [c.clave, c.label] as [string, string]));
  estadoLabel = computed(() => this.estados().find((e) => e.clave === this.estado())?.label ?? this.estado());
  condicionLabel = computed(() => this.condiciones().find((c) => c.clave === this.condicion())?.label ?? this.condicion());

  grupos = computed(() => this.tipos().find((t) => t.id === this.tipoId())?.grupos_campos ?? []);
  tieneComputadora = computed(() => this.grupos().includes('computadora'));
  tieneRadio = computed(() => this.grupos().includes('radio'));
  tieneBateria = computed(() => this.grupos().includes('bateria'));
  tieneDron = computed(() => this.grupos().includes('dron'));
  tieneSpecs = computed(() => this.grupos().length > 0);

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    this.navGuard.register(this.backHandler);
    void this.init();
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
    for (const f of [...this.fotos(), ...this.fotosSpecs()]) if (f.blob) URL.revokeObjectURL(f.previewUrl);
  }

  private async init(): Promise<void> {
    const id = this.route.snapshot.paramMap.get('id');
    try {
      const [tipos, estados, condiciones, bodegas] = await Promise.all([
        this.tec.getTipos(),
        this.tec.getEstados(),
        this.tec.getCondiciones(),
        this.inventario.getBodegas().catch(() => [] as Bodega[]),
      ]);
      this.tipos.set(tipos);
      this.estados.set(estados);
      this.condiciones.set(condiciones);
      this.bodegas.set(bodegas);
      if (estados.length && !estados.some((e) => e.clave === this.estado())) this.estado.set(estados[0].clave);
      if (condiciones.length && !condiciones.some((c) => c.clave === this.condicion())) this.condicion.set(condiciones[0].clave);
      if (id && id !== 'nuevo') {
        this.equipoId.set(id);
        await this.hidratar(id);
      }
    } finally {
      this.loading.set(false);
    }
  }

  private async hidratar(id: string): Promise<void> {
    const e = await this.tec.getEquipo(id);
    if (!e) return;
    this.nombre.set(e.nombre);
    this.marca.set(e.marca ?? '');
    this.modelo.set(e.modelo ?? '');
    this.serie.set(e.serie ?? '');
    this.estado.set(e.estado);
    this.condicion.set(e.condicion);
    this.tipoId.set(e.tipo_id ?? '');
    this.bodegaId.set(e.bodega_id ?? '');
    this.responsableExterno.set(e.responsable_externo ?? '');
    this.costo.set(e.costo);
    this.moneda.set(e.moneda ?? 'DOP');
    this.costoOrigen.set(e.costo_origen ?? 'compra');
    this.fechaCompra.set(e.fecha_compra ?? '');
    this.fechaCompraDesconocida.set(e.fecha_compra_desconocida);
    this.garantiaHasta.set(e.garantia_hasta ?? '');
    this.garantiaDesconocida.set(e.garantia_desconocida);
    this.notas.set(e.notas ?? '');
    this.serviceTag.set(e.service_tag ?? '');
    this.codigoServicio.set(e.codigo_servicio ?? '');
    this.numeroParte.set(e.numero_parte ?? '');
    this.modeloRegulatorio.set(e.modelo_regulatorio ?? '');
    this.anioFabricacion.set(e.anio_fabricacion);
    this.codigoAnterior.set(e.codigo_anterior ?? '');
    this.imei.set(e.imei ?? '');
    this.etiquetaTaller.set(e.etiqueta_taller ?? '');

    const s = e.specs;
    if (s) {
      this.procesador.set(s.procesador ?? '');
      this.ramGb.set(s.ram_gb);
      this.ramVelocidad.set(s.ram_velocidad ?? '');
      this.almacenamientoTipo.set(s.almacenamiento_tipo ?? '');
      this.almacenamientoGb.set(s.almacenamiento_gb);
      this.gpuIntegrada.set(s.gpu_integrada ?? '');
      this.gpuDedicada.set(s.gpu_dedicada ?? '');
      this.gpuMemoriaGb.set(s.gpu_memoria_gb);
      this.so.set(s.so ?? '');
      this.soVersion.set(s.so_version ?? '');
      this.pantallaPulgadas.set(s.pantalla_pulgadas);
      this.resolucion.set(s.resolucion ?? '');
      this.tactil.set(!!s.tactil);
      this.nombreWindows.set(s.nombre_windows ?? '');
      this.usuarioWindows.set(s.usuario_windows ?? '');
      this.cargadorVoltaje.set(s.cargador_voltaje ?? '');
      this.cargadorAmperaje.set(s.cargador_amperaje ?? '');
      this.frecuencia.set(s.frecuencia ?? '');
      this.potenciaW.set(s.potencia_w);
      this.tipoRadio.set(s.tipo_radio ?? '');
      this.selloTelserdomRadio.set(s.sello_telserdom_radio ?? '');
      this.selloTelserdomBateria.set(s.sello_telserdom_bateria ?? '');
      this.bateriaModelo.set(s.bateria_modelo ?? '');
      this.bateriaCapacidad.set(s.bateria_capacidad);
      this.bateriaUnidad.set(s.bateria_unidad ?? '');
      this.bateriaVoltaje.set(s.bateria_voltaje ?? '');
      this.bateriaSello.set(s.bateria_sello ?? '');
      this.accesoriosTexto.set((s.accesorios ?? []).join(', '));
      this.camaraSpecs.set(s.camara_specs ?? '');
    }

    const paths = (e.fotos && e.fotos.length ? e.fotos : [e.foto_portada, e.foto_path].filter((p): p is string => !!p));
    const items: FotoItem[] = [];
    for (const p of paths) {
      const url = await this.tec.fotoUrl(p);
      if (url) items.push({ key: p, path: p, previewUrl: url });
    }
    this.fotos.set(items);
    this.portadaKey.set(e.foto_portada ?? paths[0] ?? null);

    const specsItems: FotoItem[] = [];
    for (const p of e.fotos_specs ?? []) {
      const url = await this.tec.fotoUrl(p);
      if (url) specsItems.push({ key: p, path: p, previewUrl: url });
    }
    this.fotosSpecs.set(specsItems);
  }

  private tieneDatos(): boolean {
    return !!(this.nombre().trim() || this.tipoId() || this.fotos().length || this.marca().trim() || this.serie().trim());
  }

  // ── Tipo inline ──
  async agregarTipo(): Promise<void> {
    const label = this.nuevoTipo().trim();
    if (!label || this.agregandoTipo()) return;
    this.agregandoTipo.set(true);
    try {
      const t = await this.tec.addTipo(label);
      this.tipos.update((l) => [...l, t]);
      this.tipoId.set(t.id);
      this.nuevoTipo.set('');
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo agregar el tipo.');
    } finally {
      this.agregandoTipo.set(false);
    }
  }

  // ── Fotos (equipo) ──
  async tomarFoto(): Promise<void> {
    const p = await this.camera.takePhoto();
    if (p) this.pushFoto(p);
  }
  async elegirFotos(): Promise<void> {
    const ps = await this.camera.pickFromGallery();
    for (const p of ps) this.pushFoto(p);
  }
  private pushFoto(p: CapturedPhoto): void {
    const key = crypto.randomUUID();
    this.fotos.update((l) => [...l, { key, blob: p.blob, previewUrl: p.previewUrl }]);
    if (!this.portadaKey()) this.portadaKey.set(key);
  }
  quitarFoto(key: string): void {
    this.fotos.update((l) => {
      const f = l.find((x) => x.key === key);
      if (f?.blob) URL.revokeObjectURL(f.previewUrl);
      return l.filter((x) => x.key !== key);
    });
    if (this.portadaKey() === key) this.portadaKey.set(this.fotos()[0]?.key ?? null);
  }
  marcarPortada(key: string): void {
    this.portadaKey.set(key);
  }
  esPortada(key: string): boolean {
    return this.portadaKey() === key;
  }

  // ── Fotos de especificaciones (DA-14) — sin portada, evidencia de "Información del sistema" ──
  async tomarFotoSpecs(): Promise<void> {
    const p = await this.camera.takePhoto();
    if (p) this.pushFotoSpecs(p);
  }
  async elegirFotosSpecs(): Promise<void> {
    const ps = await this.camera.pickFromGallery();
    for (const p of ps) this.pushFotoSpecs(p);
  }
  private pushFotoSpecs(p: CapturedPhoto): void {
    this.fotosSpecs.update((l) => [...l, { key: crypto.randomUUID(), blob: p.blob, previewUrl: p.previewUrl }]);
  }
  quitarFotoSpecs(key: string): void {
    this.fotosSpecs.update((l) => {
      const f = l.find((x) => x.key === key);
      if (f?.blob) URL.revokeObjectURL(f.previewUrl);
      return l.filter((x) => x.key !== key);
    });
  }

  // ── Nav ──
  next(): void {
    if (!this.pasoValido()) return;
    this.step.update((s) => Math.min(TOTAL, s + 1));
  }
  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }
  pasoValido(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.nombre().trim()) {
          this.toast.error('Escribe el nombre del equipo.');
          return false;
        }
        return true;
      case 2:
        if (!this.tipoId()) {
          this.toast.error('Elige el tipo de equipo.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  private armarSpecs(): Partial<Omit<TecEquipoSpecs, 'equipo_id'>> | null {
    if (!this.tieneSpecs()) return null;
    const out: Partial<Omit<TecEquipoSpecs, 'equipo_id'>> = {};
    if (this.tieneComputadora()) {
      Object.assign(out, {
        procesador: this.procesador().trim() || null,
        ram_gb: this.ramGb(),
        ram_velocidad: this.ramVelocidad().trim() || null,
        almacenamiento_tipo: this.almacenamientoTipo() || null,
        almacenamiento_gb: this.almacenamientoGb(),
        gpu_integrada: this.gpuIntegrada().trim() || null,
        gpu_dedicada: this.gpuDedicada().trim() || null,
        gpu_memoria_gb: this.gpuMemoriaGb(),
        so: this.so().trim() || null,
        so_version: this.soVersion().trim() || null,
        pantalla_pulgadas: this.pantallaPulgadas(),
        resolucion: this.resolucion().trim() || null,
        tactil: this.tactil(),
        nombre_windows: this.nombreWindows().trim() || null,
        usuario_windows: this.usuarioWindows().trim() || null,
        cargador_voltaje: this.cargadorVoltaje().trim() || null,
        cargador_amperaje: this.cargadorAmperaje().trim() || null,
      });
    }
    if (this.tieneRadio()) {
      Object.assign(out, {
        frecuencia: this.frecuencia().trim() || null,
        potencia_w: this.potenciaW(),
        tipo_radio: this.tipoRadio() || null,
        sello_telserdom_radio: this.selloTelserdomRadio().trim() || null,
        sello_telserdom_bateria: this.selloTelserdomBateria().trim() || null,
      });
    }
    if (this.tieneBateria()) {
      Object.assign(out, {
        bateria_modelo: this.bateriaModelo().trim() || null,
        bateria_capacidad: this.bateriaCapacidad(),
        bateria_unidad: this.bateriaUnidad() || null,
        bateria_voltaje: this.bateriaVoltaje().trim() || null,
        bateria_sello: this.bateriaSello().trim() || null,
      });
    }
    if (this.tieneDron()) {
      out.camara_specs = this.camaraSpecs().trim() || null;
    }
    const accesorios = this.accesoriosTexto()
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (accesorios.length) out.accesorios = accesorios;
    return out;
  }

  async guardar(): Promise<void> {
    if (this.submitting()) return;
    if (!this.nombre().trim()) {
      this.toast.error('Escribe el nombre del equipo.');
      return;
    }
    if (!this.tipoId()) {
      this.toast.error('Elige el tipo de equipo.');
      return;
    }
    this.submitting.set(true);
    try {
      await this.tec.enqueueGuardar({
        id: this.equipoId() ?? undefined,
        nombre: this.nombre().trim(),
        tipoId: this.tipoId() || null,
        bodegaId: this.bodegaId() || null,
        costo: this.costo(),
        moneda: this.moneda(),
        marca: this.marca().trim() || null,
        modelo: this.modelo().trim() || null,
        serie: this.serie().trim() || null,
        estado: this.estado(),
        condicion: this.condicion(),
        notas: this.notas().trim() || null,
        fotosExistentes: this.fotos().filter((f) => f.path).map((f) => f.path as string),
        fotosNuevas: this.fotos().filter((f) => f.blob).map((f) => ({ key: f.key, blob: f.blob as Blob })),
        portadaKey: this.portadaKey(),
        responsableExterno: this.responsableExterno().trim() || null,
        costoOrigen: this.costoOrigen(),
        fechaCompra: this.fechaCompraDesconocida() ? null : this.fechaCompra() || null,
        fechaCompraDesconocida: this.fechaCompraDesconocida(),
        garantiaHasta: this.garantiaDesconocida() ? null : this.garantiaHasta() || null,
        garantiaDesconocida: this.garantiaDesconocida(),
        serviceTag: this.serviceTag().trim() || null,
        codigoServicio: this.codigoServicio().trim() || null,
        numeroParte: this.numeroParte().trim() || null,
        modeloRegulatorio: this.modeloRegulatorio().trim() || null,
        anioFabricacion: this.anioFabricacion(),
        codigoAnterior: this.codigoAnterior().trim() || null,
        imei: this.imei().trim() || null,
        etiquetaTaller: this.etiquetaTaller().trim() || null,
        fotosSpecsExistentes: this.fotosSpecs().filter((f) => f.path).map((f) => f.path as string),
        fotosSpecsNuevas: this.fotosSpecs().filter((f) => f.blob).map((f) => ({ key: f.key, blob: f.blob as Blob })),
        specs: this.armarSpecs(),
      });
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar el equipo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/tecnologia-inventario'], { replaceUrl: true });
  }

  intentarSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.location.back();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.location.back();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
}
