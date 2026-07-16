import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { StepBar } from '../../../shared/ui/step-bar/step-bar';
import { PhotoSlot } from '../../../shared/ui/photo-slot/photo-slot';
import { OptionButton } from '../../../shared/ui/option-button/option-button';
import { BigConfirm } from '../../../shared/ui/big-confirm/big-confirm';
import { Skeleton } from '../../../shared/ui/skeleton/skeleton';
import { CapturedPhoto } from '../../../core/services/camera.service';
import { VehiculosService } from '../../../core/services/vehiculos.service';
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
  imports: [FormsModule, DecimalPipe, StepBar, PhotoSlot, OptionButton, BigConfirm, Skeleton],
  templateUrl: './mantenimiento.html',
  styleUrl: './mantenimiento.scss',
})
export class MantenimientoPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private vehiculos = inject(VehiculosService);
  private mantenimientos = inject(MantenimientosService);
  private network = inject(NetworkService);
  private toast = inject(ToastService);

  readonly total = TOTAL_STEPS;
  readonly maxFotos = MAX_FOTOS;
  readonly tipos = TIPOS;
  readonly slots = Array.from({ length: MAX_FOTOS }, (_, i) => i);

  vehiculoId = '';
  placa = signal('');
  modelo = signal('');
  loading = signal(true); // APP-038 — skeleton mientras carga el vehículo

  step = signal(1);
  tipo = signal<MantenimientoTipo | null>(null);
  descripcion = signal('');
  km = signal<number | null>(null);
  fotos = signal<Record<number, CapturedPhoto>>({});

  submitting = signal(false);
  done = signal(false);

  constructor() {
    this.vehiculoId = this.route.snapshot.paramMap.get('vehiculoId') ?? '';
    void this.loadVehiculo();
  }

  private async loadVehiculo(): Promise<void> {
    try {
      const v = await this.vehiculos.getVehiculo(this.vehiculoId);
      if (v) {
        this.placa.set(v.placa);
        this.modelo.set(`${v.marca} ${v.modelo}`);
      }
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
  }

  onFotoCleared(idx: number): void {
    this.fotos.update((f) => {
      const next = { ...f };
      delete next[idx];
      return next;
    });
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
