import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { CollapsibleSelect } from '../../../shared/ui/collapsible-select/collapsible-select';
import { SelectOption } from '../../../shared/ui/select-list/select-list';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { VehiculoPicker } from '../../../shared/ui/vehiculo-picker/vehiculo-picker';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { Img } from '../../../shared/ui/img/img';
import { GuardedWizard } from '../../../shared/guarded-wizard';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoDetalle, VehiculoDisponible } from '../../../core/models/transporte.model';
import { CombustibleService } from '../../../core/services/combustible.service';
import { ConductoresService } from '../../../core/services/conductores.service';
import { ConducesService } from '../../../core/services/conduces.service';
import { UserContextService } from '../../../core/services/user-context.service';
import { Proyecto } from '../../../core/models/bitacora.model';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CombustibleCalculo,
  calcularCombustible,
  UltimaEchada,
  PrecioCombustibleVigente,
  PRODUCTO_CANONICO_LABEL,
  productoCanonico,
  RENDIMIENTO_ESTADO_META,
  RendimientoEstadoMeta,
} from '../../../core/models/combustible.model';

/**
 * AE6 — pasos LÓGICOS del wizard (la cantidad y el contenido dependen del modo:
 * estación / persona / depósito en obra). El orden nace de AE6:
 *   1) `bomba`    — la foto de la bomba en 0 (o evidencia en depósito) es lo
 *                   PRIMERO que se pide, antes de digitar nada.
 *   2) `digits`   — km + galones + monto.
 *   3) `fotos`    — el resto de fotos (recibo + tablero); no aplica al depósito.
 *   4) `detalles` — producto/Regular-Premium/tarjeta/titular/obra.
 *   5) `estacion` — "¿En qué estación?" + el cálculo automático (paso propio para
 *                   quitar el scroll largo del antiguo paso 3); no aplica al depósito.
 *   6) `revisar`  — resumen y envío.
 */
type CombStep = 'bomba' | 'digits' | 'fotos' | 'detalles' | 'estacion' | 'revisar';

/**
 * Fuel-log wizard (registro de combustible). The chofer digits only 3 numbers
 * — km actual, galones, monto — and the app derives price/gal, km recorridos,
 * rendimiento and costo/km live (mirroring the server). Photos are camera-only:
 * bomba-en-0 FIRST (AE6), then recibo + tablero, plus a "Combustible registrado"
 * confirmation with a green/amber consumption band. Saved offline via the outbox.
 */
@Component({
  selector: 'app-combustible',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, CollapsibleSelect, ConfirmDialog, Skeleton, VehiculoPicker, WizardFooter, Img, WizardExit, KmInput],
  templateUrl: './combustible.html',
  styleUrl: './combustible.scss',
})
export class CombustiblePage extends GuardedWizard {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private combustible = inject(CombustibleService);
  private conductores = inject(ConductoresService);
  private conduces = inject(ConducesService);
  private ctx = inject(UserContextService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  vehiculoId = '';
  necesitaVehiculo = signal(false); // B1 — elegir del pool cuando no llega por ruta
  // AF18 — solo el asignado registra en su vehículo; admin (Xaviel) ve todos (QA).
  soloMisVehiculos = computed(() => !this.ctx.esAdmin());
  // AF19 — máximo km entre echadas (flota_config.umbral_km_echada, default 1000).
  umbralKm = signal(1000);
  // Z23-app — echada de tarjeta asignada a una PERSONA (sin vehículo ni odómetro).
  modoPersona = signal(false);
  titular = signal('');
  placa = signal('');
  modelo = signal('');
  fotoUrl = signal<string | null>(null); // U6
  vehDetalle = signal<VehiculoDetalle | null>(null); // U6 — odómetro + mantenimiento
  /** U6 — odómetro efectivo (servidor + outbox) como referencia del KmInput. */
  odometro = computed(() => this.vehDetalle()?.kilometraje ?? null);
  private conductorId: string | null = null;

  ultima = signal<UltimaEchada>({
    km: null,
    fecha: null,
    promedio_rendimiento: null,
    n_echadas: 0,
  });

  step = signal(1);

  /**
   * AE6 — la secuencia de pasos depende del modo. En depósito en obra no hay
   * fotos de recibo/tablero ni estación (garrafón), así que esos pasos se omiten.
   * La bomba/evidencia siempre es el primer paso.
   */
  steps = computed<CombStep[]>(() =>
    this.esDeposito()
      ? ['bomba', 'digits', 'detalles', 'revisar']
      : ['bomba', 'digits', 'fotos', 'detalles', 'estacion', 'revisar'],
  );
  total = computed(() => this.steps().length);
  /** Clave lógica del paso actual (1-based → índice del array). */
  stepKey = computed<CombStep>(() => this.steps()[this.step() - 1] ?? 'revisar');

  km = signal<number | null>(null);
  galones = signal<number | null>(null);
  monto = signal<number | null>(null);
  // Z9 — solo "Total Energies" (preseleccionada) + "Otro" (input libre). Se dejó
  // de listar el catálogo completo: en campo casi siempre es Total Energies y lo
  // demás va por "Otro".
  private static readonly ESTACIONES_FALLBACK = ['Total Energies'];
  estaciones = signal<string[]>(CombustiblePage.ESTACIONES_FALLBACK);
  estacion = signal('Total Energies');
  estacionOtro = signal(false);
  estacionOtroTexto = signal('');
  // Z23-app — producto (para conciliar con el reporte) + tarjeta (opcional).
  // Default 'diesel' (la flota es mayormente diésel); el chofer cambia a gasolina.
  producto = signal<'diesel' | 'gasolina'>('diesel');
  // AA20 — subtipo Regular/Premium (obligatorio) + precio oficial de referencia.
  // AF20 — default 'premium' (la flota siempre echa diésel premium); editable.
  subtipo = signal<'regular' | 'premium' | null>('premium');
  precios = signal<PrecioCombustibleVigente[]>([]);
  readonly productoCanonicoLabel = PRODUCTO_CANONICO_LABEL;
  precioRef = computed<PrecioCombustibleVigente | null>(() => {
    const canon = productoCanonico(this.producto(), this.subtipo());
    return this.precios().find((p) => p.producto === canon) ?? null;
  });
  tarjeta = signal('');
  estacionesVisibles = computed(() =>
    this.estaciones().filter((e) => e.trim().toLowerCase() !== 'otro'),
  );
  fotoRecibo = signal<CapturedPhoto | null>(null);
  fotoTablero = signal<CapturedPhoto | null>(null);
  fotoBomba = signal<CapturedPhoto | null>(null); // Y4 — bomba/estación en 0

  // AC11 — depósito en obra (telehandler): se echa desde garrafón, sin estación
  // ni precio de bomba; galones + obra + horas del equipo + foto de evidencia.
  origen = signal<'estacion' | 'deposito_obra'>('estacion');
  proyectoId = signal<string | null>(null);
  // AI14 — obra por dropdown estándar (opcional: "Sin especificar" limpia el valor).
  obraOptions = computed<SelectOption[]>(() => [
    { id: '', label: '— Sin especificar —' },
    ...this.proyectos().map((p) => ({ id: p.id, label: p.nombre })),
  ]);
  proyectos = signal<Proyecto[]>([]);
  fotoEvidencia = signal<CapturedPhoto | null>(null);
  /** Telehandler = equipo medido por horas (medida_uso='horas'). */
  esTelehandler = computed(() => this.vehDetalle()?.medida_uso === 'horas');
  esDeposito = computed(() => this.origen() === 'deposito_obra');
  /** AC11 — nombre de la obra elegida (para el resumen). */
  obraNombre = computed(() => this.proyectos().find((p) => p.id === this.proyectoId())?.nombre ?? null);

  submitting = signal(false);
  done = signal(false);
  /** Snapshot of the live calc shown on the confirmation screen. */
  resultado = signal<CombustibleCalculo | null>(null);

  /** AD7 — banda de estado del rendimiento en la confirmación (preview local). */
  estadoBand = computed<{ meta: RendimientoEstadoMeta; motivo: string } | null>(() => {
    const r = this.resultado();
    if (!r) return null;
    return { meta: RENDIMIENTO_ESTADO_META[r.estado], motivo: r.estadoMotivo };
  });

  /** Live derivation shown in the dark box (mirrors the server). */
  calc = computed(() =>
    calcularCombustible(this.km(), this.galones(), this.monto(), this.ultima(), this.esTelehandler()),
  );

  /** true when km isn't greater than the vehicle's last fill-up. */
  kmInvalido = computed(() => {
    const km = this.km();
    const prev = this.ultima().km;
    return km != null && prev != null && km <= prev;
  });

  primeraEchada = computed(() => this.ultima().km == null);

  /** AF19 — el salto de km respecto a la última echada supera el umbral (irreal). */
  kmDeltaExcede = computed(() => {
    const km = this.km();
    const prev = this.ultima().km;
    const u = this.umbralKm();
    return km != null && prev != null && u > 0 && km - prev > u;
  });

  // Y4 — las 3 fotos son obligatorias (recibo + tablero + bomba en 0).
  // Z23-app — en una echada de persona no hay tablero (odómetro): recibo + bomba.
  // AC11 — en depósito en obra solo la foto de evidencia del garrafón/equipo.
  fotosCompletas = computed(() => {
    if (this.esDeposito()) return !!this.fotoEvidencia();
    return this.modoPersona()
      ? !!this.fotoRecibo() && !!this.fotoBomba()
      : !!this.fotoRecibo() && !!this.fotoTablero() && !!this.fotoBomba();
  });
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo

  constructor() {
    super();
    this.registerBackGuard();
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    // Z9 — ya no se carga el catálogo de estaciones (solo Total Energies + Otro).
    // AA20 — precios oficiales de referencia (offline cache del último conocido).
    void this.combustible.getPreciosVigentes().then((p) => this.precios.set(p));
    // AF19 — umbral de km entre echadas (configurable en flota_config, offline-cache).
    void this.conductores.getFlotaConfig().then((c) => this.umbralKm.set(c.umbralKmEchada));
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    // B1 — deep-link por vehículo salta el paso; sin él, se elige del pool.
    if (this.vehiculoId) {
      this.cargarVehiculo();
    } else {
      this.necesitaVehiculo.set(true);
      this.loading.set(false);
    }
  }

  /** B1 — vehículo elegido del pool: continúa el registro con ese vehículo. */
  onVehiculoElegido(v: VehiculoDisponible): void {
    this.vehiculoId = v.vehiculo_id;
    this.necesitaVehiculo.set(false);
    this.loading.set(true);
    this.cargarVehiculo();
  }

  /**
   * Z23-app — echada de tarjeta-persona (sin vehículo): salta el selector y el
   * odómetro. Solo se piden monto/galones, producto, tarjeta, titular y fotos
   * (recibo + bomba; no hay tablero). Igual queda atribuida al conductor logueado.
   */
  elegirPersona(): void {
    this.modoPersona.set(true);
    this.vehiculoId = '';
    this.necesitaVehiculo.set(false);
    this.loading.set(false);
    void this.loadConductor();
  }

  /** AS16 — atajo a "Uso de vehículo" desde el vacío de Registrar combustible. */
  irAUsarVehiculo(): void {
    void this.router.navigate(['/transporte/uso-vehiculo']);
  }

  private cargarVehiculo(): void {
    void this.loadVehiculo();
    void this.loadUltima();
    void this.loadConductor();
  }

  /** Z9 — elegir la estación (Total Energies). */
  pickEstacion(nombre: string): void {
    this.estacion.set(nombre);
    this.estacionOtro.set(false);
  }
  /** T4 — "Otro": escribir una estación fuera del catálogo. */
  pickEstacionOtro(): void {
    this.estacionOtro.set(true);
    this.estacion.set('');
  }
  /** Estación final que viaja en el payload (texto, retrocompatible). */
  private estacionFinal(): string {
    return (this.estacionOtro() ? this.estacionOtroTexto() : this.estacion()).trim();
  }

  /** U4 — datos capturados sin guardar (tras registrar ya no hay nada que perder).
   *  La estación preseleccionada (Total Energies) NO cuenta como dato del usuario. */
  tieneDatos(): boolean {
    return (
      !this.done() &&
      (this.km() != null ||
        this.galones() != null ||
        this.monto() != null ||
        !!this.estacionOtroTexto().trim() ||
        !!this.tarjeta().trim() ||
        !!this.titular().trim() || // Z23-app
        !!this.fotoRecibo() ||
        !!this.fotoTablero() ||
        !!this.fotoBomba() ||
        !!this.fotoEvidencia()) // AC11
    );
  }

  private async loadVehiculo(): Promise<void> {
    try {
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
        if (v.foto_path) this.fotoUrl.set(await this.vehiculos.getFotoUrl(v.foto_path));
      }
      // U6 — detalle con km EFECTIVO (servidor + outbox) + datos de mantenimiento
      // para que el KmInput muestre el odómetro real y el estado en vivo.
      void this.vehiculos.getVehiculoDetalle(this.vehiculoId).then((d) => {
        this.vehDetalle.set(d);
        // AC11 — telehandler (medido por horas): preselecciona "Depósito en obra"
        // y carga las obras para elegir dónde se echó.
        if (d?.medida_uso === 'horas') {
          this.origen.set('deposito_obra');
          void this.loadProyectos();
        }
      });
    } finally {
      this.loading.set(false);
    }
  }

  /** AC11 — obras/proyectos para el depósito en obra (cache compartida, offline). */
  private async loadProyectos(): Promise<void> {
    const list = await this.conduces.getProyectos();
    this.proyectos.set(list);
    // Preseleccionar la obra activa del usuario si está en la lista.
    const obra = this.ctx.obraActiva()?.id ?? null;
    if (obra && !this.proyectoId() && list.some((p) => p.id === obra)) {
      this.proyectoId.set(obra);
    }
  }

  /** AC11 — alternar estación / depósito en obra (solo disponible en telehandler). */
  setOrigen(o: 'estacion' | 'deposito_obra'): void {
    this.origen.set(o);
    if (o === 'deposito_obra' && !this.proyectos().length) void this.loadProyectos();
  }

  onFotoEvidencia(photo: CapturedPhoto): void {
    this.fotoEvidencia.set(photo);
  }
  onFotoEvidenciaCleared(): void {
    this.fotoEvidencia.set(null);
  }

  private async loadUltima(): Promise<void> {
    this.ultima.set(await this.combustible.getUltimaEchada(this.vehiculoId));
  }

  private async loadConductor(): Promise<void> {
    const c = await this.conductores.getMiConductor();
    this.conductorId = c?.id ?? null;
  }

  onFotoRecibo(photo: CapturedPhoto): void {
    this.fotoRecibo.set(photo);
  }
  onFotoReciboCleared(): void {
    this.fotoRecibo.set(null);
  }
  onFotoTablero(photo: CapturedPhoto): void {
    this.fotoTablero.set(photo);
  }
  onFotoTableroCleared(): void {
    this.fotoTablero.set(null);
  }
  onFotoBomba(photo: CapturedPhoto): void {
    this.fotoBomba.set(photo);
  }
  onFotoBombaCleared(): void {
    this.fotoBomba.set(null);
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total(), s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** U6 — el km escrito es menor al odómetro registrado (regla no-retroceso). */
  kmMenorOdometro = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });

  private canAdvance(): boolean {
    switch (this.stepKey()) {
      // AE6 — paso 1: la foto de la bomba en 0 (o evidencia en depósito) es lo
      // PRIMERO. Sin ella no se avanza.
      case 'bomba': {
        const foto = this.esDeposito() ? this.fotoEvidencia() : this.fotoBomba();
        if (!foto) {
          this.toast.error(this.esDeposito() ? 'Toma la foto de evidencia.' : 'Toma la foto de la bomba en 0.');
          return false;
        }
        return true;
      }
      // Paso digits: km + galones + monto (tipo hoja, sin scroll largo).
      case 'digits': {
        // Z23-app — la echada de persona no tiene odómetro: se salta el km.
        if (!this.modoPersona()) {
          const km = this.km();
          if (km == null || km <= 0) {
            this.toast.error('Escribe el kilometraje actual.');
            return false;
          }
          if (this.kmMenorOdometro()) {
            this.toast.error(`El kilometraje no puede ser menor al registrado (${this.odometro()} km).`);
            return false;
          }
          if (this.kmInvalido()) {
            this.toast.error(`El kilometraje debe ser mayor a la última echada (${this.ultima().km} km).`);
            return false;
          }
          // AF19 — salto de km irreal: bloquea al chofer; el admin puede seguir
          // (queda marcado km_alerta en el servidor). El server también lo valida.
          if (this.kmDeltaExcede()) {
            const delta = km! - this.ultima().km!;
            if (this.ctx.esAdmin()) {
              this.toast.show(
                `Salto de ${delta} km (supera el máximo de ${this.umbralKm()} km). Puedes continuar como admin; quedará marcado para revisión.`,
                'info',
                6000,
              );
            } else {
              this.toast.error(
                `El salto de kilometraje (${delta} km) supera el máximo permitido (${this.umbralKm()} km). Verifica el odómetro.`,
              );
              return false;
            }
          }
        }
        if (!this.galones() || this.galones()! <= 0) {
          this.toast.error('Escribe los galones echados.');
          return false;
        }
        // AC11 — en depósito en obra el monto/costo es opcional (garrafón).
        if (!this.esDeposito() && (!this.monto() || this.monto()! <= 0)) {
          this.toast.error('Escribe el monto pagado.');
          return false;
        }
        return true;
      }
      // AE6 — paso fotos: el resto de fotos (recibo + tablero); la bomba ya se
      // tomó en el paso 1.
      case 'fotos': {
        if (!this.fotoRecibo()) {
          this.toast.error('Falta la foto del recibo.');
          return false;
        }
        if (!this.modoPersona() && !this.fotoTablero()) {
          this.toast.error('Falta la foto del tablero.');
          return false;
        }
        return true;
      }
      // Paso detalles: producto + Regular/Premium + tarjeta/titular/obra.
      case 'detalles': {
        // AA20 — el subtipo (Regular/Premium) es obligatorio (no aplica al depósito).
        if (!this.esDeposito() && !this.subtipo()) {
          this.toast.error('Elige Regular o Premium.');
          return false;
        }
        // Z23-app — el titular es obligatorio en una echada de persona.
        if (this.modoPersona() && !this.titular().trim()) {
          this.toast.error('Escribe el titular de la tarjeta.');
          return false;
        }
        return true;
      }
      // AE6 — paso estación: "¿En qué estación?" + cálculo automático.
      case 'estacion': {
        if (this.estacionOtro() && !this.estacionOtroTexto().trim()) {
          this.toast.error('Escribe el nombre de la estación.');
          return false;
        }
        return true;
      }
    }
    return true;
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.fotosCompletas()) {
      this.toast.error('Faltan fotos para guardar.');
      return;
    }
    this.submitting.set(true);
    try {
      const estacion = this.estacionFinal();
      const persona = this.modoPersona();
      const deposito = this.esDeposito(); // AC11
      await this.combustible.registrar({
        // Z23-app — echada de persona: sin vehículo ni odómetro ni foto de tablero.
        vehiculoId: persona ? null : this.vehiculoId,
        conductorId: this.conductorId,
        fecha: new Date().toISOString().slice(0, 10),
        kilometraje: persona ? null : this.km()!,
        galones: this.galones()!,
        // AC11 — depósito en obra: el costo es opcional (0 si no se conoce).
        monto: this.monto() ?? 0,
        // AC11 — sin estación en depósito en obra.
        estacion: deposito ? null : estacion ? estacion : null,
        origen: this.origen(), // AC11
        proyectoId: deposito ? this.proyectoId() : null, // AC11
        producto: this.producto(), // Z23-app
        subtipo: deposito ? null : this.subtipo(), // AA20 (no aplica al depósito)
        tarjeta: deposito ? null : this.tarjeta().trim() || null, // Z23-app
        titular: persona ? this.titular().trim() || null : null, // Z23-app
        titularEsPersona: persona, // Z23-app
        // AC11 — fotos según el origen: depósito=evidencia; estación=recibo/tablero/bomba.
        fotoRecibo: deposito ? null : this.fotoRecibo()!.blob,
        fotoTablero: persona || deposito ? null : this.fotoTablero()!.blob,
        fotoBomba: deposito ? null : this.fotoBomba()!.blob,
        fotoEvidencia: deposito ? this.fotoEvidencia()!.blob : null,
        placa: persona ? '' : this.placa(),
      });
      this.resultado.set(this.calc());
      this.done.set(true);
    } catch (e) {
      this.toast.error(e instanceof Error ? e.message : 'No se pudo guardar. Intenta de nuevo.');
    } finally {
      this.submitting.set(false);
    }
  }

  finish(): void {
    void this.router.navigate(['/transporte'], { replaceUrl: true });
  }

  /**
   * V4 — salir del estado "Elige un vehículo" volviendo al hub de transporte.
   * Y8 — usar location.back() (NO router.navigate a /transporte): navegar empujaba
   * un hub DUPLICADO sobre el actual, y el "atrás" siguiente re-entraba a
   * combustible (loop, regresión S31). back() hace pop → hub → home limpio.
   */
  salirPicker(): void {
    this.location.back();
  }

  get online(): boolean {
    return this.network.online();
  }
}
