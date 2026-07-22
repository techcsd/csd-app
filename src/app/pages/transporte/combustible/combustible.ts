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
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  CombustibleCalculo,
  calcularCombustible,
  UltimaEchada,
} from '../../../core/models/combustible.model';

const TOTAL_STEPS = 5;

/**
 * Fuel-log wizard (registro de combustible). The chofer digits only 3 numbers
 * — km actual, galones, monto — and the app derives price/gal, km recorridos,
 * rendimiento and costo/km live (mirroring the server). Two mandatory photos
 * (recibo + tablero), then a "Combustible registrado" confirmation with a
 * green/amber consumption band. Saved offline via the outbox.
 */
@Component({
  selector: 'app-combustible',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, ConfirmDialog, Skeleton, VehiculoPicker, WizardFooter, Img, WizardExit, KmInput],
  templateUrl: './combustible.html',
  styleUrl: './combustible.scss',
})
export class CombustiblePage extends GuardedWizard {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private combustible = inject(CombustibleService);
  private conductores = inject(ConductoresService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  readonly total = TOTAL_STEPS;

  vehiculoId = '';
  necesitaVehiculo = signal(false); // B1 — elegir del pool cuando no llega por ruta
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
  km = signal<number | null>(null);
  galones = signal<number | null>(null);
  monto = signal<number | null>(null);
  // T4 — estación por catálogo (Total Energies preseleccionada) + "Otro" libre.
  private static readonly ESTACIONES_FALLBACK = ['Total Energies', 'Shell', 'Esso', 'Sunix', 'United', 'Texaco'];
  estaciones = signal<string[]>(CombustiblePage.ESTACIONES_FALLBACK);
  estacion = signal('Total Energies');
  estacionOtro = signal(false);
  estacionOtroTexto = signal('');
  estacionesVisibles = computed(() =>
    this.estaciones().filter((e) => e.trim().toLowerCase() !== 'otro'),
  );
  fotoRecibo = signal<CapturedPhoto | null>(null);
  fotoTablero = signal<CapturedPhoto | null>(null);

  submitting = signal(false);
  done = signal(false);
  /** Snapshot of the live calc shown on the confirmation screen. */
  resultado = signal<CombustibleCalculo | null>(null);

  /** Live derivation shown in the dark box (mirrors the server). */
  calc = computed(() =>
    calcularCombustible(this.km(), this.galones(), this.monto(), this.ultima()),
  );

  /** true when km isn't greater than the vehicle's last fill-up. */
  kmInvalido = computed(() => {
    const km = this.km();
    const prev = this.ultima().km;
    return km != null && prev != null && km <= prev;
  });

  primeraEchada = computed(() => this.ultima().km == null);

  fotosCompletas = computed(() => !!this.fotoRecibo() && !!this.fotoTablero());
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo

  constructor() {
    super();
    this.registerBackGuard();
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    void this.loadEstaciones();
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

  private cargarVehiculo(): void {
    void this.loadVehiculo();
    void this.loadUltima();
    void this.loadConductor();
  }

  /** T4 — carga el catálogo de estaciones (offline-friendly; fallback local). */
  private async loadEstaciones(): Promise<void> {
    const list = await this.combustible.getEstaciones();
    if (list.length) this.estaciones.set(list);
  }

  /** T4 — elegir una estación del catálogo (nombre canónico). */
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
        !!this.fotoRecibo() ||
        !!this.fotoTablero())
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
      void this.vehiculos.getVehiculoDetalle(this.vehiculoId).then((d) => this.vehDetalle.set(d));
    } finally {
      this.loading.set(false);
    }
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

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
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
    const s = this.step();
    if (s === 1) {
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
    }
    if (s === 2) {
      if (!this.galones() || this.galones()! <= 0) {
        this.toast.error('Escribe los galones echados.');
        return false;
      }
      if (!this.monto() || this.monto()! <= 0) {
        this.toast.error('Escribe el monto pagado.');
        return false;
      }
    }
    if (s === 3) {
      if (this.estacionOtro() && !this.estacionOtroTexto().trim()) {
        this.toast.error('Escribe el nombre de la estación.');
        return false;
      }
    }
    if (s === 4 && !this.fotosCompletas()) {
      this.toast.error('Faltan fotos para continuar.');
      return false;
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
      await this.combustible.registrar({
        vehiculoId: this.vehiculoId,
        conductorId: this.conductorId,
        fecha: new Date().toISOString().slice(0, 10),
        kilometraje: this.km()!,
        galones: this.galones()!,
        monto: this.monto()!,
        estacion: estacion ? estacion : null,
        fotoRecibo: this.fotoRecibo()!.blob,
        fotoTablero: this.fotoTablero()!.blob,
        placa: this.placa(),
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

  get online(): boolean {
    return this.network.online();
  }
}
