import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { DecimalPipe, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { WizardFooter } from '../../../shared/ui/wizard-footer/wizard-footer';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { WizardExit } from '../../../shared/ui/wizard-exit/wizard-exit';
import { KmInput } from '../../../shared/ui/km-input/km-input';
import { resetScrollOnStep } from '../../../shared/util/scroll';
import { NavGuardService } from '../../../core/services/nav-guard.service';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { AutosaveService } from '../../../core/services/autosave.service';
import { BorradorService } from '../../../core/services/borrador.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
import { VehiculoDetalle } from '../../../core/models/transporte.model';
import {
  MantenimientosService,
  MantenimientoTipo,
} from '../../../core/services/mantenimientos.service';
import { NetworkService } from '../../../core/services/network.service';
import { ToastService } from '../../../core/services/toast.service';

interface TipoOpcion {
  valor: MantenimientoTipo;
  label: string;
  icon: string;
  tone: 'default' | 'success' | 'warning' | 'error';
}

const TIPOS: TipoOpcion[] = [
  { valor: 'preventivo', label: 'Preventivo', icon: '🛠️', tone: 'success' },
  { valor: 'correctivo', label: 'Correctivo', icon: '🔧', tone: 'warning' },
  { valor: 'emergencia', label: 'Emergencia', icon: '🚨', tone: 'error' },
];

const TOTAL_STEPS = 4;
const MAX_FOTOS = 3;

/**
 * Report a vehicle maintenance (mantenimiento) from the field: type,
 * description, optional km + up to 3 photos. Saved offline via the outbox.
 * Mirrors the pre-use checklist wizard.
 */
@Component({
  selector: 'app-mantenimiento',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, BigConfirm, Skeleton, WizardFooter, ConfirmDialog, WizardExit, KmInput],
  templateUrl: './mantenimiento.html',
  styleUrl: './mantenimiento.scss',
})
export class MantenimientoPage implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private mantenimientos = inject(MantenimientosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);
  private navGuard = inject(NavGuardService);
  private autosave = inject(AutosaveService);
  private borrador = inject(BorradorService);
  private location = inject(Location);

  readonly total = TOTAL_STEPS;
  readonly maxFotos = MAX_FOTOS;
  readonly tipos = TIPOS;
  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  vehiculoId = '';
  placa = signal('');
  modelo = signal('');
  vehDetalle = signal<VehiculoDetalle | null>(null); // U15 — odómetro + mantenimiento
  odometro = computed(() => this.vehDetalle()?.kilometraje ?? null);
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo

  step = signal(1);
  tipo = signal<MantenimientoTipo | null>(null);
  descripcion = signal('');
  km = signal<number | null>(null);
  fotos = signal<Record<number, CapturedPhoto>>({});

  submitting = signal(false);
  done = signal(false);
  confirmSalir = signal(false); // Q7
  borradorPrevio = signal(false);
  private hydrated = false;

  /** U15 — km opcional, pero si se llena NO puede ser menor al odómetro. */
  kmMenorOdometro = computed(() => {
    const km = this.km();
    const odo = this.odometro();
    return km != null && odo != null && km < odo;
  });

  private get clave(): string {
    return `mantenimiento:${this.vehiculoId}`;
  }

  private readonly backHandler = (): boolean => {
    if (!this.done() && this.tieneDatos()) {
      this.confirmSalir.set(true);
      return true;
    }
    return false;
  };

  constructor() {
    resetScrollOnStep(() => this.step(), () => this.done()); // U3/U4
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.loadVehiculo();
    void this.restoreDraft();
    this.navGuard.register(this.backHandler); // Q7 — botón físico Android
    // U15 — autosave (regla: todo formulario lo tiene).
    effect(() => {
      const snap = { tipo: this.tipo(), descripcion: this.descripcion(), km: this.km(), step: this.step() };
      if (!this.hydrated || this.submitting() || this.done()) return;
      this.autosave.queue(this.clave, snap, { tipo: 'mantenimiento', etiqueta: 'Mantenimiento', ruta: this.location.path() });
    });
  }

  ngOnDestroy(): void {
    this.navGuard.clear(this.backHandler);
  }

  private async restoreDraft(): Promise<void> {
    const draft = await this.borrador.load<{ tipo: MantenimientoTipo | null; descripcion: string; km: number | null; step: number }>(this.clave);
    if (draft) {
      this.tipo.set(draft.tipo ?? null);
      this.descripcion.set(draft.descripcion ?? '');
      this.km.set(draft.km ?? null);
      const fotos = await this.borrador.loadFotos(this.clave);
      if (fotos.length) {
        const map: Record<number, CapturedPhoto> = {};
        for (const f of fotos) {
          const idx = Number(f.slot);
          if (Number.isFinite(idx)) map[idx] = { blob: f.blob, previewUrl: URL.createObjectURL(f.blob) };
        }
        this.fotos.set(map);
      }
      this.borradorPrevio.set(true);
    }
    this.hydrated = true;
  }

  /** Q7 — ¿hay datos sin guardar? */
  private tieneDatos(): boolean {
    return (
      !!this.tipo() ||
      !!this.descripcion().trim() ||
      this.km() != null ||
      Object.keys(this.fotos()).length > 0
    );
  }

  intentarSalir(): void {
    if (!this.done() && this.tieneDatos()) this.confirmSalir.set(true);
    else this.salir();
  }
  confirmarSalir(): void {
    this.confirmSalir.set(false);
    this.salir();
  }
  cancelarSalir(): void {
    this.confirmSalir.set(false);
  }
  private salir(): void {
    // S31 — location.back() vuelve al hub sin duplicarlo (atrás llega a home).
    this.location.back();
  }

  private async loadVehiculo(): Promise<void> {
    try {
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
      }
      // U15 — detalle con km EFECTIVO + mantenimiento para el KmInput en vivo.
      void this.vehiculos.getVehiculoDetalle(this.vehiculoId).then((d) => this.vehDetalle.set(d));
    } finally {
      this.loading.set(false);
    }
  }

  tipoLabel(): string {
    return this.tipos.find((t) => t.valor === this.tipo())?.label ?? '';
  }

  fotosCount(): number {
    return Object.keys(this.fotos()).length;
  }

  onFoto(idx: number, photo: CapturedPhoto): void {
    this.fotos.update((f) => ({ ...f, [idx]: photo }));
    void this.borrador.saveFoto(this.clave, String(idx), photo.blob); // U15 — persistir
  }

  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
    void this.borrador.removeFoto(this.clave, String(idx));
  }

  next(): void {
    if (!this.canAdvance()) return;
    this.step.update((s) => Math.min(this.total, s + 1));
  }

  prev(): void {
    this.step.update((s) => Math.max(1, s - 1));
  }

  /** Per-step gate so the user can't skip required fields. */
  canAdvance(): boolean {
    switch (this.step()) {
      case 1:
        if (!this.tipo()) {
          this.toast.error('Elige el tipo de mantenimiento.');
          return false;
        }
        return true;
      case 2:
        if (!this.descripcion().trim()) {
          this.toast.error('Describe el mantenimiento.');
          return false;
        }
        if (this.kmMenorOdometro()) {
          this.toast.error(`El kilometraje no puede ser menor al registrado (${this.odometro()} km).`);
          return false;
        }
        return true;
      case 3:
        if (this.fotosCount() < 1) {
          this.toast.error('Adjunta al menos 1 foto del mantenimiento.');
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  async submit(): Promise<void> {
    if (this.submitting()) return;
    if (!this.tipo()) {
      this.toast.error('Elige el tipo de mantenimiento.');
      return;
    }
    const descripcion = this.descripcion().trim();
    if (!descripcion) {
      this.toast.error('Describe el mantenimiento.');
      return;
    }
    if (this.kmMenorOdometro()) {
      this.toast.error(`El kilometraje no puede ser menor al registrado (${this.odometro()} km).`);
      return;
    }
    if (this.fotosCount() < 1) {
      this.toast.error('Adjunta al menos 1 foto del mantenimiento.');
      return;
    }
    this.submitting.set(true);
    try {
      const fotosMap = this.fotos();
      const fotos = this.slots
        .map((i) => fotosMap[i]?.blob)
        .filter((b): b is Blob => !!b);

      await this.mantenimientos.enqueueMantenimiento({
        vehiculoId: this.vehiculoId,
        tipo: this.tipo()!,
        descripcion,
        fecha: new Date().toISOString().slice(0, 10),
        km: this.km(),
        fotos,
        placa: this.placa(),
      });
      await this.autosave.discard(this.clave); // limpia borrador + fotos
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
